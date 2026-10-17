-- Every make x model x component month with its trailing 12-month baseline, the spike
-- test, and what happened next. A month is a spike when complaints are at least
-- signal_ratio x baseline, at least signal_min_complaints, and at least
-- signal_min_z standard deviations above baseline under a Poisson assumption.
--
-- A spike is only a signal if no recall on the same model and component was
-- filed in the signal_recall_lookback_days before the month ended: complaints
-- that follow a recall are owners reacting to it, not an early warning.
-- A signal is "followed by a recall" only if the recall came after the month
-- ended (when the month's data is complete) and within signal_followup_days.
--
-- The second outcome is an NHTSA investigation (PE, EA, RQ or AQ) on the same
-- make, model and component group. Matching on model alone made the base rate
-- 56%, since popular models nearly always have some investigation open. The
-- price: an investigation filed under a different component is missed (Tesla's
-- "phantom braking" complaints were Service Brakes, its investigation Forward
-- Collision Avoidance). An investigation opened in the signal month itself
-- counts, since NHTSA often acts on those complaints.
with baseline as (
    select
        *,
        {{ dbt.dateadd('month', 1, 'month') }} as next_month_start,
        -- trailing 12 months, excluding the current month (written out per
        -- column because Snowflake has no WINDOW clause)
        avg(complaints) over (partition by make, model, component_group order by month
                              rows between 12 preceding and 1 preceding) as baseline_mean,
        stddev_samp(complaints) over (partition by make, model, component_group order by month
                              rows between 12 preceding and 1 preceding) as baseline_std,
        count(*) over (partition by make, model, component_group order by month
                              rows between 12 preceding and 1 preceding) as history_months
    from {{ ref('int_model_component_month_counts') }}
),

scored as (
    select
        *,
        complaints / nullif(baseline_mean, 0)                         as ratio_to_baseline,
        -- complaint counts are roughly Poisson, so the expected spread is sqrt(mean)
        (complaints - baseline_mean) / nullif(sqrt(baseline_mean), 0) as z_score,
        (complaints - baseline_mean) / nullif(baseline_std, 0)        as z_score_empirical,
        coalesce(
            component_group not in ({% for c in var('signal_exclude_components') %}'{{ c }}'{{ ', ' if not loop.last }}{% endfor %})
            and history_months >= {{ var('signal_min_history_months') }}
            and complaints >= {{ var('signal_min_complaints') }},
            false
        )                                                             as is_testable
    from baseline
),

recalls as (
    select distinct make, model, component_group, campaign_number, report_received_date as recall_date
    from {{ ref('fct_recalls') }}
    where report_received_date is not null
),

investigations as (
    select distinct make, model, component_group, action_number, opened_date
    from {{ ref('stg_investigations') }}
    where action_type in ('PE', 'EA', 'RQ', 'AQ') and opened_date is not null
),

outcomes as (
    select
        s.make,
        s.model,
        s.component_group,
        s.month,
        max(case when r.recall_date < s.next_month_start then r.recall_date end)  as prior_recall_date,
        min(case when r.recall_date >= s.next_month_start then r.recall_date end) as next_recall_date
    from scored s
    join recalls r
        on r.make = s.make
        and r.model = s.model
        and r.component_group = s.component_group
        and {{ dbt.dateadd('day', var('signal_recall_lookback_days'), 'r.recall_date') }} >= s.next_month_start
        and r.recall_date < {{ dbt.dateadd('day', var('signal_followup_days'), 's.next_month_start') }}
    group by 1, 2, 3, 4
),

next_campaign as (
    select o.make, o.model, o.component_group, o.month, min(r.campaign_number) as next_recall_campaign
    from outcomes o
    join recalls r
        on r.make = o.make and r.model = o.model and r.component_group = o.component_group
        and r.recall_date = o.next_recall_date
    group by 1, 2, 3, 4
),

investigation_outcomes as (
    select
        s.make,
        s.model,
        s.component_group,
        s.month,
        min(i.opened_date) as next_investigation_date
    from scored s
    join investigations i
        on i.make = s.make
        and i.model = s.model
        and i.component_group = s.component_group
        and i.opened_date >= s.month
        and i.opened_date < {{ dbt.dateadd('day', var('signal_followup_days'), 's.next_month_start') }}
    group by 1, 2, 3, 4
),

next_investigation as (
    select o.make, o.model, o.component_group, o.month, o.next_investigation_date,
           min(i.action_number) as next_investigation_number
    from investigation_outcomes o
    join investigations i
        on i.make = o.make and i.model = o.model and i.component_group = o.component_group
        and i.opened_date = o.next_investigation_date
    group by 1, 2, 3, 4, 5
),

flagged as (
    select
        s.*,
        o.prior_recall_date,
        o.next_recall_date,
        c.next_recall_campaign,
        i.next_investigation_date,
        i.next_investigation_number,
        coalesce(
            s.is_testable
            and s.complaints >= {{ var('signal_ratio') }} * s.baseline_mean
            and s.z_score >= {{ var('signal_min_z') }},
            false
        )                                                             as is_spike
    from scored s
    left join outcomes o
        on o.make = s.make and o.model = s.model and o.component_group = s.component_group and o.month = s.month
    left join next_campaign c
        on c.make = s.make and c.model = s.model and c.component_group = s.component_group and c.month = s.month
    left join next_investigation i
        on i.make = s.make and i.model = s.model and i.component_group = s.component_group and i.month = s.month
)

select
    md5(make || '|' || model || '|' || component_group || '|' || cast(month as varchar)) as model_component_month_key,
    make,
    model,
    component_group,
    month,
    next_month_start,
    complaints,
    crashes,
    fires,
    injuries,
    baseline_mean,
    baseline_std,
    history_months,
    ratio_to_baseline,
    z_score,
    z_score_empirical,
    is_testable and prior_recall_date is null                             as is_eligible,
    is_spike,
    is_spike and prior_recall_date is null                                as is_signal,
    prior_recall_date,
    next_recall_date,
    {{ dbt.datediff('next_month_start', 'next_recall_date', 'day') }}            as days_to_recall,
    next_recall_campaign,
    next_investigation_date,
    next_investigation_number,
    -- negative when the investigation opened during the signal month
    {{ dbt.datediff('next_month_start', 'next_investigation_date', 'day') }}     as days_to_investigation,
    {{ dbt.dateadd('day', var('signal_followup_days'), 'next_month_start') }} <= data_through as followup_complete
from flagged
