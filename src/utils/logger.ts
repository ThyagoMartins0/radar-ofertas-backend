import pino from 'pino';

import { env } from '../config/env.js';
import { createLogCaptureStream } from './log-store.js';

const level = env.NODE_ENV === 'production' ? 'info' : 'debug';

export const logger = pino(
  {
    level,
    // pino only applies its Error serializer to the `err` key by default; most of
    // this codebase logs caught errors under `error`, which would otherwise drop
    // the message and stack (leaving just `{ name }`). Serialize both keys.
    serializers: {
      error: pino.stdSerializers.err,
      err: pino.stdSerializers.err,
    },
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: createLogCaptureStream(), level: 'debug' },
  ]),
);
