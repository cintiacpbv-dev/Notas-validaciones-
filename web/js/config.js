/* Conexión predeterminada con Supabase (uso personal, sin inicio de sesión).
   Con estos valores la app (APK, web y Vercel) queda conectada automáticamente:
   proyectos, PDF y agenda se guardan en tu Supabase. Los apuntes locales que ya
   existían se conservan y se suben.
   En Vercel este archivo se regenera con las variables SUPABASE_URL y SUPABASE_ANON_KEY
   (ver tools/build-config.js). */
window.MISNOTAS_CONFIG = {
    supabaseUrl: 'https://cgxdpzjkxpselrsbcqpa.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNneGRwempreHBzZWxyc2JjcXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NTk0MDgsImV4cCI6MjEwNjEzNTQwOH0.EFujI_MjAaSzgSJcM3-ZfdmSRYIyf_LsuktMoxIbCcc'
};
