-- Typed NHTSA defect investigations and petitions.
-- Grain: one row per action x make/model/year x component.
-- action_type: PE preliminary evaluation, EA engineering analysis, RQ recall
-- query, AQ audit query, DP defect petition, EQ equipment query.
with source as (
    select * from {{ source('raw', 'investigations') }}
),

typed as (
    select
        upper(trim(action_number))                    as action_number,
        substr(upper(trim(action_number)), 1, 2)      as action_type,
        upper(trim(make))                             as make,
        upper(trim(model))                            as model,
        nullif(try_cast(year as integer), 9999)       as model_year,
        upper(trim(compname))                         as component_desc,
        -- a few rows have a blank component; NHTSA's catch-all group takes them
        coalesce(nullif(trim(split_part(upper(compname), ':', 1)), ''), 'UNKNOWN OR OTHER') as component_group,
        {{ parse_yyyymmdd('odate') }}                 as opened_date,
        {{ parse_yyyymmdd('cdate') }}                 as closed_date,
        nullif(upper(trim(campno)), '')               as campaign_number,
        trim(subject)                                 as subject,
        cast(_loaded_at as varchar)                   as loaded_at
    from source
    where action_number is not null and trim(action_number) <> ''
),

keyed as (
    select
        md5(action_number || '|' || make || '|' || model || '|'
            || coalesce(cast(model_year as varchar), 'UNKNOWN') || '|' || component_desc) as investigation_row_key,
        *
    from typed
)

select *
from keyed
qualify row_number() over (partition by investigation_row_key order by loaded_at desc) = 1
