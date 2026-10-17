-- For each recall: complaints for that make/model and component in the 180 days
-- before it, and days from the first complaint in the loaded window. Note the
-- window starts at START_YEAR, so days_first_complaint_to_recall is a lower bound.
with recalls as (
    select campaign_number, make, model, component_group,
           min(report_received_date) as report_received_date,
           max(potentially_affected) as potentially_affected
    from {{ ref('fct_recalls') }}
    group by 1, 2, 3, 4
),

complaints as (
    select v.make, v.model, f.component_group, f.received_date
    from {{ ref('fct_complaints') }} f
    join {{ ref('dim_vehicle') }} v on v.vehicle_key = f.vehicle_key
)

select
    r.campaign_number,
    r.make,
    r.model,
    r.component_group,
    r.report_received_date,
    r.potentially_affected,
    count(c.received_date)  as complaints_before_recall,
    sum(case when c.received_date >= {{ dbt.dateadd('day', -180, 'r.report_received_date') }} then 1 else 0 end) as complaints_180d_before_recall,
    min(c.received_date)    as first_complaint_date,
    {{ dbt.datediff('min(c.received_date)', 'r.report_received_date', 'day') }} as days_first_complaint_to_recall
from recalls r
left join complaints c
    on c.make = r.make
    and c.model = r.model
    and c.component_group = r.component_group
    and c.received_date <= r.report_received_date
group by 1, 2, 3, 4, 5, 6
