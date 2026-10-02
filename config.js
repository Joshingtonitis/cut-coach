// Cloud sync settings. Leave both empty and the app works exactly as before, offline
// and on this device only. To turn sync on, paste the two values from your Supabase
// project (Project Settings → API) and run supabase/setup.sql once (see README → Sync).
//
// The anon key is meant to be public: it only lets a signed-in user reach their own
// rows, enforced by the row-level security rules in setup.sql. Never put the
// service_role / secret key here.
window.PG_CONFIG = {
  supabaseUrl: '',      // e.g. 'https://abcd1234.supabase.co'
  supabaseAnonKey: '',  // the long "anon" / "publishable" key
};
