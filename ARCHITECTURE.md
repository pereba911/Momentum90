# Momentum 90 — Arquitectura

Documento de referencia arquitectónica del proyecto. La fuente de verdad operativa es el código y esta política.

---

## Política de actualizaciones globales y datos aislados

> **Política permanente.** Se aplica a toda modificación de código, UI, diseño, estilos, PWA, navegación, dashboard, CRM, IA, validaciones, fórmulas, componentes, botones, vistas y correcciones, sin excepciones.

### Regla 1 — Globalidad del código
Toda modificación de código, UI, diseño, estilos, PWA, navegación, dashboard, CRM, IA, validaciones, fórmulas, componentes, botones, vistas y correcciones **debe estar disponible globalmente para TODOS los usuarios autenticados** al publicarse un nuevo build.

### Regla 2 — La disponibilidad nunca depende del usuario
La disponibilidad de una función **nunca** debe depender de:

- un email específico;
- un `user_id` específico;
- la cuenta temporal;
- la cuenta admin;
- que el usuario tenga registros previos;
- que exista `app_data` previo;
- que exista configuración personalizada previa.

### Regla 3 — Aislamiento de datos personales
Los datos personales **siempre** permanecen aislados por `auth.uid()` / `user_id`:

- ingresos;
- gastos;
- deudas;
- abonos;
- activos;
- metas;
- contactos;
- negocios;
- pipeline;
- ajustes;
- saldo inicial;
- flujo y efectivo calculado;
- registros de voz;
- notas;
- preferencias y configuraciones personalizadas.

### Regla 4 — Sin cruce de datos entre usuarios
Nunca copiar, fusionar, sincronizar ni sobrescribir datos entre usuarios.

### Regla 5 — Defaults en código, solo como fallback en memoria
Las configuraciones globales/default deben vivir **en código** y usarse **solo como fallback en memoria**:

- etapas predeterminadas;
- categorías sugeridas;
- valores visuales;
- copy/UI;
- reglas de validación.

**Nunca** deben escribirse automáticamente al `app_data` del usuario al cargar la app.

### Regla 6 — Usuarios sin datos
Para usuarios sin datos:

- mostrar estado vacío útil;
- mostrar defaults visuales;
- permitir crear su primer registro;
- no producir errores;
- no inicializar datos financieros automáticamente.

### Regla 7 — Prueba obligatoria de cada feature
Toda nueva feature debe incluir esta prueba:

1. Usuario A con datos.
2. Usuario B sin datos.
3. Ambos ven la **misma funcionalidad e interfaz**.
4. Cada uno ve **únicamente sus propios datos**.
5. Una escritura de A **no aparece ni modifica** a B.

### Regla 8 — Documentación y checklist
Esta política vive en este documento. Toda feature nueva debe pasar la [checklist de aceptación](#checklist-de-aceptación-para-futuras-features) antes de publicarse.

### Regla 9 — Sin RLS ni migraciones para documentar
Documentar esta regla **no** implica cambios de RLS, migraciones ni modificación de datos existentes.

---

## Garantía de globalidad (sin instrucciones manuales)

Una actualización de código es global **automáticamente** porque cumple estos invariantes, que son estructurales (no requieren instrucción manual por feature):

1. **No hay gating por identidad en el código.** No existen condicionales que comparen `user.email` / `user.id` / cuentas específicas para habilitar/ocultar funcionalidad. El único rol especial (`admin`) se resuelve por `profile.role` en datos y solo aplica a acciones administrativas explícitas, nunca a la disponibilidad de una feature para el resto.

2. **El build se sirve igual a todos.** Vite empaqueta un único bundle; el deploy de Netlify sirve el mismo bundle a todos los usuarios autenticados. Una feature nueva aparece para todos al publicar el build.

3. **Los datos se resuelven por sesión.** Todas las escrituras/lecturas usan el `access_token` de la sesión y el servidor resuelve `user.id` desde el JWT (`auth.uid()`). No hay datos globales compartidos en el cliente.

4. **Los defaults viven en memoria.** Cuando no existe `app_data` ni configuración personalizada, la UI usa constantes del código como fallback en memoria y **nunca** las persiste automáticamente (solo se escriben por acción explícita del usuario).

5. **El estado vacío es de primera clase.** Las entidades sin registros renderizan estados vacíos útiles con CTA para crear el primer registro, sin errores ni inicialización financiera automática.

---

## Checklist de aceptación para futuras features

Antes de considerar una feature lista para publicar, verificar:

- [ ] **Globalidad**: la feature está disponible para todos los usuarios autenticados tras el build (sin importar email/`user_id`/datos previos).
- [ ] **Sin gating**: no hay condicionales por email, `user_id`, cuenta temporal o cuenta admin para la disponibilidad.
- [ ] **Aislamiento**: los datos se leen/escriben solo del usuario autenticado (`auth.uid()`).
- [ ] **Sin cruce**: una escritura del usuario A no aparece ni modifica al usuario B (probado con A con datos y B sin datos).
- [ ] **Defaults en memoria**: las configuraciones default viven en código y solo son fallback en memoria; no se escriben solas al `app_data`.
- [ ] **Estado vacío**: usuarios sin datos ven estado vacío útil + CTA, sin errores ni datos financieros inicializados.
- [ ] **Prueba A/B**: usuario A con datos y usuario B sin datos ven la misma UI/feature y solo sus propios datos.
- [ ] **Build limpio**: `npm run build` pasa sin errores y el bundle de producción contiene la feature.

---

## Referencias de implementación

- Defaults de etapas: `DEFAULT_BIZ_STAGES` / `DEFAULT_CONTACT_STAGES` en `src/app/App.tsx` (fallback en memoria, nunca auto-persistidos).
- Rol administrativo: `profile.role === "admin"` (solo para acciones administrativas explícitas; no condiciona features globales).
- Cliente Supabase: `src/lib/supabase.ts` (sesión con `access_token`; mutaciones vía servidor que resuelve `user.id`).
