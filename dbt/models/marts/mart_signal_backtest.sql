-- How good is the signal rule, and how does that change with its thresholds?
-- Uses only months with a full follow-up window. For each threshold pair:
-- how many months it flags, how often a recall on the same make, model and component
-- followed within signal_followup_days, and the lift over the base rate of
-- every eligible month (enough history and volume, no recent recall).
with months as (
    select *
    from {{ ref('mart_model_component_monthly') }}
    where is_eligible and followup_complete
),

base as (
    select
        count(*)                                                       as eligible_months,
        sum(case when next_recall_date is not null then 1 else 0 end)  as eligible_hits
    from months
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

scored as (
    select
        g.min_z,
        g.ratio,
        count(m.month)                                                     as signals,
        sum(case when m.next_recall_date is not null then 1 else 0 end)    as hits,
        median(m.days_to_recall)                                           as median_days_to_recall
    from grid g
    left join months m
        on m.z_score >= g.min_z
        and m.complaints >= g.ratio * m.baseline_mean
    group by 1, 2
)

select
    s.min_z,
    s.ratio,
    s.signals,
    s.hits,
    s.hits * 1.0 / nullif(s.signals, 0)                                    as hit_rate,
    b.eligible_months,
    b.eligible_hits * 1.0 / nullif(b.eligible_months, 0)                   as base_rate,
    (s.hits * 1.0 / nullif(s.signals, 0))
        / nullif(b.eligible_hits * 1.0 / nullif(b.eligible_months, 0), 0)  as lift,
    s.median_days_to_recall,
    s.min_z = {{ var('signal_min_z') }} and s.ratio = {{ var('signal_ratio') }} as is_current
from scored s
cross join base b
