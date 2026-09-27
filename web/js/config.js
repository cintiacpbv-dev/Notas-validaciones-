/* Configuración opcional de la nube (Supabase).
   Si llenas estos dos valores, todos los dispositivos quedarán conectados a tu
   proyecto automáticamente y solo tendrás que iniciar sesión.
   Los encuentras en Supabase → Project Settings → API.
   La "anon key" es pública por diseño: la seguridad la dan las políticas RLS de supabase/schema.sql. */
window.MISNOTAS_CONFIG = {
    supabaseUrl: '',      // ej. 'https://abcdefghijkl.supabase.co'
    supabaseAnonKey: ''   // ej. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
