import fastifyEnv from '@fastify/env';
import fp from 'fastify-plugin';

const envSchema = {
    type: 'object',
    required: ['PORT'],
    properties: {
        PORT: {
            type: 'integer',
            default: 3000,
        },
        HOST: {
            type: 'string',
            default: '0.0.0.0',
        },
        NODE_ENV: {
            type: 'string',
            default: 'development',
        },
    },
};

function configPlugin(app) {
    const envOptions = {
        confKey: 'config',
        schema: envSchema,
        dotenv:
            process.env.NODE_ENV === 'development'
                ? {
                    path: '.env',
                    encoding: 'utf-8',
                }
                : false,
    };

    app.register(fastifyEnv, envOptions);
}

export default fp(configPlugin);
