import fastifyEnv from '@fastify/env';
import fp from 'fastify-plugin';

const envSchema = {
    type: 'object',
    required: ['PORT'],
    properties: {
        PORT: {
            type: 'integer',
            default: 3000
        },
        HOST: {
            type: 'string',
            default: '0.0.0.0'
        },
        NODE_ENV: {
            type: 'string',
            default: 'development'
        }
    }
};

async function configPlugin(app, options) {
    const envOptions = {
        confKey: 'config',
        schema: envSchema,
        dotenv: {
            path: '.env',
            encoding: 'utf-8',
            debug: false
        }
    };

    await app.register(fastifyEnv, envOptions);
}

export default fp(configPlugin);