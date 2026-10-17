-- Grain: one row per recall campaign x vehicle x component group.
select
    md5(r.campaign_number || '|' || r.make || '|' || r.model || '|'
        || coalesce(cast(r.model_year as varchar), 'UNKNOWN') || '|' || r.component_group) as recall_key,
    r.campaign_number,
    md5(r.make || '|' || r.model || '|' || coalesce(cast(r.model_year as varchar), 'UNKNOWN')) as vehicle_key,
    r.make,
    r.model,
    r.model_year,
    r.component_group,
    min(r.report_received_date)  as report_received_date,
    max(r.potentially_affected)  as potentially_affected
from {{ ref('stg_recalls') }} r
where r.recall_type = 'V'   -- vehicle recalls; drops tires, child seats, equipment
group by 1, 2, 3, 4, 5, 6, 7
