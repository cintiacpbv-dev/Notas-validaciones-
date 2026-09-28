/* Conexión predeterminada con Supabase.
   Con estos valores la app (APK, web y Vercel) queda conectada automáticamente:
   el usuario solo inicia sesión o crea su cuenta. Sus apuntes locales se conservan
   y se suben a la nube al iniciar sesión.
   En Vercel este archivo se regenera con las variables SUPABASE_URL y SUPABASE_ANON_KEY
   (ver tools/build-config.js). La "anon key" es pública por diseño; la seguridad
   la dan las reglas RLS de supabase/schema.sql. */
window.MISNOTAS_CONFIG = {
    supabaseUrl: 'https://cgxdpzjkxpselrsbcqpa.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNneGRwempreHBzZWxyc2JjcXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NTk0MDgsImV4cCI6MjEwNjEzNTQwOH0.EFujI_MjAaSzgSJcM3-ZfdmSRYIyf_LsuktMoxIbCcc'
};
