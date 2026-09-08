
  # Goal Assistant 90

  Aplicación de **ejecución personal**: metas, plan 90/120, hábitos, tareas, logros,
  oportunidades y seguimiento de progreso, con persistencia y sincronización vía Supabase.

  > **Referencia financiera:** Momentum 90 V2 (https://itsmomentum90.netlify.app/) es la
  > aplicación financiera de referencia. Goal Assistant 90 no duplica esa contabilidad como
  > módulos independientes; conserva su propio historial de metas y progreso sin crear una
  > segunda capa financiera.

  ## Architecture

  Read [ARCHITECTURE.md](./ARCHITECTURE.md) — includes the permanent **policy of global updates and isolated data** plus the acceptance checklist for every new feature.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Tests

  Run `npm test` to run the test suite (migración idempotente, preservación de IDs,
  aislamiento entre usuarios, ausencia de voz, estados vacíos y cálculo de progreso).

  Run `npm run build` to produce the production bundle.
  