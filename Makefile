# Local run on DuckDB. For Snowflake: export the variables in .env.example
# and use TARGET=snowflake with DBT_TARGET=prod.
PY ?= python3
DBT_TARGET ?= dev

.PHONY: sample download profile load build docs export serve all real clean

sample:      ## synthetic NHTSA-shaped files (no download needed)
	cd ingestion && $(PY) sample_data.py
download:    ## real NHTSA files (large)
	cd ingestion && $(PY) download.py
profile:     ## data-quality findings -> reports/data_quality.md
	cd ingestion && $(PY) profile_data.py
load:        ## files -> raw schema
	cd ingestion && $(PY) load.py
build:       ## dbt models + tests
	cd dbt && dbt build --profiles-dir . --target $(DBT_TARGET)
docs:        ## dbt docs with lineage graph at http://localhost:8080
	cd dbt && dbt docs generate --profiles-dir . --target $(DBT_TARGET) && dbt docs serve --profiles-dir .
export:      ## marts -> dashboard/data/dashboard.json
	$(PY) scripts/export_dashboard.py
serve:       ## dashboard at http://localhost:8000
	cd dashboard && $(PY) -m http.server 8000
# the synthetic sample starts in 2024
all: export START_YEAR ?= 2024
all: sample profile load build export
# real NHTSA files (~60 MB download) end to end
real: export DATA_LABEL = NHTSA
real: download profile load build export
clean:
	rm -rf data/raw/* data/*.duckdb dbt/target dbt/logs
