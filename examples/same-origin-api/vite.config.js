// Development proxy only; Spotter reads it during setup to propose web.api.
export default { server: { proxy: { '/api': 'http://127.0.0.1:4010' } } };
