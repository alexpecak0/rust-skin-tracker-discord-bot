const { createClient } = require('@supabase/supabase-js');

// Retrieve Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Basic check to ensure environment variables are loaded
if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Error: SUPABASE_URL or SUPABASE_ANON_KEY not found in .env file.');
    // Optionally, you could throw an error or exit, but logging might be sufficient
    // depending on whether Supabase is critical for all bot functions.
    // process.exit(1);
}

// Create and export the Supabase client instance
// It's generally safe to initialize it here. If the keys were missing,
// subsequent operations will fail, alerting you to the problem.
let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('[INFO] Supabase client initialized.');
} else {
    console.warn('[WARNING] Supabase client NOT initialized due to missing credentials.');
}

module.exports = supabase; 