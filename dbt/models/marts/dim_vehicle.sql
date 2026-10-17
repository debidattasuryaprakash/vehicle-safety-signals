-- Every make / model / model year seen in complaints or recalls.
with vehicles as (
    select make, model, model_year from {{ ref('stg_complaints') }}
    union
    select make, model, model_year from {{ ref('stg_recalls') }}
)

select
    md5(make || '|' || model || '|' || coalesce(cast(model_year as varchar), 'UNKNOWN')) as vehicle_key,
    make,
    model,
    model_year
from vehicles
