<?php
// Copy outside the public web directory to grogu-private/config.php.
return [
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'grogu',
    'db_user' => 'replace-me',
    'db_password' => 'replace-me',
    'base_url' => 'https://grogu.example.com',
    // Generate at least 32 random bytes, e.g. bin2hex(random_bytes(32)).
    'setup_key' => 'replace-with-64-random-hex-characters',
    // Only for local testing, never enable on an internet-facing server.
    'allow_insecure_local' => false,
];
