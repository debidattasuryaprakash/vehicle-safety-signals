-- Grain: one row per complaint x vehicle x component group. A complaint can
-- list several components, and occasionally more than one vehicle.
-- Incremental: a normal run rebuilds only complaints received in the last
-- incremental_lookback_days (late-arriving components land there); run with
-- --full-refresh after changing this model.
{{ config(materialized='incremental', unique_key='complaint_component_key', on_schema_change='fail') }}

select
    md5(c.odi_number || '|' || c.make || '|' || c.model || '|'
        || coalesce(cast(c.model_year as varchar), 'UNKNOWN') || '|' || c.component_group) as complaint_component_key,
    c.odi_number,
    md5(c.make || '|' || c.model || '|' || coalesce(cast(c.model_year as varchar), 'UNKNOWN')) as vehicle_key,
    c.make,
    c.model,
    c.component_group,
    min(c.received_date)                                                  as received_date,
    cast({{ dbt.date_trunc('month', 'min(c.received_date)') }} as date)  as received_month,
    max(case when c.is_crash then 1 else 0 end) = 1                       as is_crash,
    max(case when c.is_fire then 1 else 0 end) = 1                        as is_fire,
    max(c.injuries)                                                       as injuries,
    max(c.deaths)                                                         as deaths
from {{ ref('stg_complaints') }} c
where c.received_date is not null
  and c.product_type = 'V'   -- vehicles; drops tires, child seats, equipment
{% if is_incremental() %}
  and c.odi_number in (
      select odi_number from {{ ref('stg_complaints') }}
      where received_date >= (select {{ dbt.dateadd('day', -var('incremental_lookback_days'), 'max(received_date)') }} from {{ this }})
  )
{% endif %}
group by 1, 2, 3, 4, 5, 6
