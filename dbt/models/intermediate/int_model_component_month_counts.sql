-- Monthly complaint counts per make x model x component group, one row for
-- every month from the combination's first complaint on (months with no complaints are 0, so the
-- baseline isn't inflated). The month still in progress is left out.
with latest as (
    select
        max(received_date) as data_through,
        -- first day of the month after the newest complete month
        cast({{ dbt.date_trunc('month', dbt.dateadd('day', 1, 'max(received_date)')) }} as date) as complete_before
    from {{ ref('fct_complaints') }}
),

months as (
    select distinct f.received_month as month
    from {{ ref('fct_complaints') }} f, latest
    where f.received_month < latest.complete_before
),

pairs as (
    select make, model, component_group, min(received_month) as first_month
    from {{ ref('fct_complaints') }}
    group by 1, 2, 3
),

counts as (
    select
        make,
        model,
        component_group,
        received_month         as month,
        count(*)               as complaints,
        sum(case when is_crash then 1 else 0 end) as crashes,
        sum(case when is_fire then 1 else 0 end)  as fires,
        sum(injuries)          as injuries
    from {{ ref('fct_complaints') }}
    group by 1, 2, 3, 4
)

select
    p.make,
    p.model,
    p.component_group,
    m.month,
    coalesce(c.complaints, 0) as complaints,
    coalesce(c.crashes, 0)    as crashes,
    coalesce(c.fires, 0)      as fires,
    coalesce(c.injuries, 0)   as injuries,
    latest.data_through
from pairs p
join months m on m.month >= p.first_month
cross join latest
left join counts c
    on c.make = p.make and c.model = p.model and c.component_group = p.component_group and c.month = m.month
