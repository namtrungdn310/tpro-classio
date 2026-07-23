-- Course classes are 12-week packages. Internally this maps to a 3-month cycle.

update classes
set billing_cycle_months = 3
where type = 'COURSE';
