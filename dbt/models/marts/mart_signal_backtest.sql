-- How good is the signal rule, and how does that change with its thresholds?
-- Uses only months with a full follow-up window. For each threshold pair,
-- outcome and time slice: how many months it flags, how often the outcome
-- followed, and the lift over the base rate of every eligible month (enough
-- history and volume, no recent recall) in the same slice.
--
-- outcome: 'recall' = recall on the same make, model and component;
--          'recall_or_investigation' = that, or an NHTSA investigation on the
--          same make, model and component.
-- slice:   'all', or signal months in 2020-2022 vs 2023 onwards, so thresholds
--          picked on the early years can be checked on the later ones.
with months as (
    select
        *,
        case when month < cast('2023-01-01' as date) then '2020-2022' else '2023-2025' end as period,
        case when next_recall_date is not null then 1 else 0 end                as recall_hit,
        case when next_recall_date is not null or next_investigation_date is not null
             then 1 else 0 end                                                  as action_hit,
        case
            when days_to_recall is null then days_to_investigation
            when days_to_investigation is null then days_to_recall
            when days_to_recall < days_to_investigation then days_to_recall
            else days_to_investigation
        end                                                                     as days_to_action
    from {{ ref('mart_model_component_monthly') }}
    where is_eligible and followup_complete
),

slices as (
    select 'all' as slice union all select '2020-2022' union all select '2023-2025'
),

outcomes as (
    select 'recall' as outcome union all select 'recall_or_investigation'
),

tagged as (
    select
        sl.slice,
        o.outcome,
        m.*,
        case when o.outcome = 'recall' then m.recall_hit else m.action_hit end         as hit,
        case when o.outcome = 'recall' then m.days_to_recall else m.days_to_action end as days_to_outcome
    from months m
    join slices sl on sl.slice = 'all' or sl.slice = m.period
    cross join outcomes o
),

base as (
    select slice, outcome, count(*) as eligible_months, sum(hit) as eligible_hits
    from tagged
    group by 1, 2
),

grid as (
    {%- for z in var('backtest_min_z') %}
    {%- for r in var('backtest_ratio') %}
    select cast({{ z }} as double precision) as min_z, cast({{ r }} as double precision) as ratio
    {%- if not loop.last %} union all {% endif %}
    {%- endfor %}
    {%- if not loop.last %} union all {% endif %}
    {%- endfor %}
),

frame as (
    select g.min_z, g.ratio, sl.slice, o.outcome
    from grid g cross join slices sl cross join outcomes o
),

scored as (
    select
        f.min_z,
        f.ratio,
        f.slice,
        f.outcome,
        count(t.month)                                          as signals,
        coalesce(sum(t.hit), 0)                                 as hits,
        median(case when t.hit = 1 then t.days_to_outcome end)  as median_days_to_outcome
    from frame f
    left join tagged t
        on t.slice = f.slice
        and t.outcome = f.outcome
        and t.z_score >= f.min_z
        and t.complaints >= f.ratio * t.baseline_mean
    group by 1, 2, 3, 4
)

select
    s.min_z,
    s.ratio,
    s.slice,
    s.outcome,
    s.signals,
    s.hits,
    s.hits * 1.0 / nullif(s.signals, 0)                                    as hit_rate,
    b.eligible_months,
    b.eligible_hits * 1.0 / nullif(b.eligible_months, 0)                   as base_rate,
    (s.hits * 1.0 / nullif(s.signals, 0))
        / nullif(b.eligible_hits * 1.0 / nullif(b.eligible_months, 0), 0)  as lift,
    s.median_days_to_outcome,
    s.min_z = {{ var('signal_min_z') }} and s.ratio = {{ var('signal_ratio') }} as is_current
from scored s
join base b on b.slice = s.slice and b.outcome = s.outcome
