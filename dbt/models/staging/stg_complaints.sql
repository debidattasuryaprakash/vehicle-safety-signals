-- Typed, standardised complaints. Grain: one row per complaint x component description.
with source as (
    select * from {{ source('raw', 'complaints') }}
),

typed as (
    select
        cast(cmplid as varchar)                                   as complaint_row_id,
        cast(odino as varchar)                                    as odi_number,
        upper(trim(maketxt))                                      as make,
        upper(trim(modeltxt))                                     as model,
        nullif(try_cast(yeartxt as integer), 9999)                as model_year,
        upper(trim(compdesc))                                     as component_desc,
        -- a few rows have a blank component; NHTSA's catch-all group takes them
        coalesce(nullif(trim(split_part(upper(compdesc), ':', 1)), ''), 'UNKNOWN OR OTHER') as component_group,
        crash = 'Y'                                               as is_crash,
        fire = 'Y'                                                as is_fire,
        coalesce(try_cast(injured as integer), 0)                 as injuries,
        coalesce(try_cast(deaths as integer), 0)                  as deaths,
        coalesce({{ parse_yyyymmdd('ldate') }},
                 {{ parse_yyyymmdd('datea') }})                   as received_date,
        {{ parse_yyyymmdd('faildate') }}                          as failure_date,
        upper(trim(state))                                        as state,
        upper(trim(prod_type))                                    as product_type,
        try_cast(miles as integer)                                as mileage,
        cast(_loaded_at as varchar)                               as loaded_at
    from source
    where odino is not null and trim(odino) <> ''
)

select *
from typed
-- the same row can arrive twice across file refreshes; keep one
qualify row_number() over (partition by complaint_row_id order by loaded_at desc) = 1
