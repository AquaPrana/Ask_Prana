-- Global Other Expenses for farmer_price_configs (dynamic name/unit/price items).
alter table public.farmer_price_configs
  add column if not exists other_expenses jsonb not null default '[]'::jsonb;

comment on column public.farmer_price_configs.other_expenses is
  'Dynamic global other expense items: [{id, name, unit, price}].';

notify pgrst, 'reload schema';
