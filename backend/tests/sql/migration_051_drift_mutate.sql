-- Drift mutation HỢP LỆ trên C8 sau 051: đổi giờ slot (07:00-08:00 -> 08:00-09:00).
update public.classes c
   set schedule = jsonb_set(
         c.schedule,
         '{slots}',
         (
           select jsonb_agg(
                    jsonb_set(
                      jsonb_set(x.value, '{start}', '"08:00"'::jsonb),
                      '{end}',
                      '"09:00"'::jsonb
                    )
                    order by x.ordinality
                  )
             from jsonb_array_elements(c.schedule -> 'slots')
             with ordinality as x
         )
       )
 where c.id = '20000000-0000-0000-0000-000000000008';
