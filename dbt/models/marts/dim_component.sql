-- Top-level component groups from NHTSA's component taxonomy.
select distinct component_group
from (
    select component_group from {{ ref('stg_complaints') }}
    union
    select component_group from {{ ref('stg_recalls') }}
) groups
where component_group is not null and component_group <> ''
