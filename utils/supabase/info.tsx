/* Archivo legacy de Figma Make — SIN USO en la app (no se importa en ningún lado).
   Se eliminó la clave pública hardcodeada por seguridad.
   La configuración real de Supabase vive en variables de entorno:
   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local)
*/

export const projectId = "ewkauqpuprtbewbqwtmx";
export const publicAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? "";