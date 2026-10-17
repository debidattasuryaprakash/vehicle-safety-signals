{# NHTSA stores dates as YYYYMMDD text. Each engine parses them differently,
   so this macro dispatches to the right syntax; bad values become null. #}
{% macro parse_yyyymmdd(col) %}
  {{ return(adapter.dispatch('parse_yyyymmdd', 'vehicle_signals')(col)) }}
{% endmacro %}

{% macro default__parse_yyyymmdd(col) %}
  try_to_date(nullif(trim({{ col }}), ''), 'YYYYMMDD')
{% endmacro %}

{% macro duckdb__parse_yyyymmdd(col) %}
  cast(try_strptime(nullif(trim({{ col }}), ''), '%Y%m%d') as date)
{% endmacro %}
