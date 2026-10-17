-- Typed, standardised recalls. Grain: one row per campaign x make/model/year x component.
with source as (
    select * from {{ source('raw', 'recalls') }}
),

typed as (
    select
        cast(record_id as varchar)                    as recall_row_id,
        upper(trim(campno))                           as campaign_number,
        upper(trim(maketxt))                          as make,
        upper(trim(modeltxt))                         as model,
        nullif(try_cast(yeartxt as integer), 9999)    as model_year,
        upper(trim(compname))                         as component_desc,
        -- a few rows have a blank component; NHTSA's catch-all group takes them
        coalesce(nullif(trim(split_part(upper(compname), ':', 1)), ''), 'UNKNOWN OR OTHER') as component_group,
        upper(trim(mfgname))                          as manufacturer,
        upper(trim(rcltypecd))                        as recall_type,
        try_cast(potaff as integer)                   as potentially_affected,
        {{ parse_yyyymmdd('rcdate') }}                as report_received_date,
        cast(_loaded_at as varchar)                   as loaded_at
    from source
    where campno is not null and trim(campno) <> ''
)

select *
from typed
qualify row_number() over (partition by recall_row_id order by loaded_at desc) = 1
