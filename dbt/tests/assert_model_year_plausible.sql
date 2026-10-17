-- Fails if any model year is outside a plausible range.
select model_year
from {{ ref('stg_complaints') }}
where model_year is not null
  and (model_year < 1950 or model_year > extract(year from current_date) + 2)
