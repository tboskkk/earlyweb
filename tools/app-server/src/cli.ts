import { parseArgs } from 'node:util';
import { createAppServer } from './server.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: 'dist/apps' },
    port: { type: 'string', default: '5174' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const shellOrigin = process.env.SHELL_ORIGIN ?? 'http://localhost:5173';
const server = createAppServer({ root: values.root as string, shellOrigin });
server.listen(Number(values.port), values.host as string, () => {
  console.log(
    `app server: http://${values.host}:${values.port}/ (root ${values.root}, shell ${shellOrigin})`,
  );
});
