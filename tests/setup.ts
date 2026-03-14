// Dummy environment variables for tests
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
process.env.ELASTICSEARCH_PASSWORD = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.PORT = '3000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'fatal';
