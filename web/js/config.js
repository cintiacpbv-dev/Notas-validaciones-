/* Conexión predeterminada con Supabase.
   Con estos valores la app (APK, web y Vercel) queda conectada automáticamente:
   no hace falta iniciar sesión: proyectos y agenda se guardan en Supabase con
   el código de espacio. Los apuntes locales existentes se conservan y se suben.
   En Vercel este archivo se regenera con las variables SUPABASE_URL y SUPABASE_ANON_KEY
   (ver tools/build-config.js). La "anon key" es pública por diseño; la seguridad
   la dan las reglas RLS de supabase/schema.sql. */
window.MISNOTAS_CONFIG = {
    supabaseUrl: 'https://cgxdpzjkxpselrsbcqpa.supabase.co',
    // Código de espacio: sin inicio de sesión, los datos se guardan bajo este código.
    // Todos los dispositivos con el mismo código comparten proyectos y agenda.
    espacio: 'mn-63227a0a64d5',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNneGRwempreHBzZWxyc2JjcXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NTk0MDgsImV4cCI6MjEwNjEzNTQwOH0.EFujI_MjAaSzgSJcM3-ZfdmSRYIyf_LsuktMoxIbCcc'
};
