// E2E fixture: a hostile app with no permissions that tries to escape its sandbox.
// Every check must fail in exactly the expected way to report 'blocked'; anything else
// (the attempt succeeding, a different error, or no answer at all) reports 'LEAK'.
import { connect, EwError } from '@earlyweb/sdk';

type Verdict = 'blocked' | 'LEAK';

const os = await connect();

/** 'blocked' only if touching the property throws. */
function throws(fn: () => unknown): Verdict {
  try {
    fn();
    return 'LEAK';
  } catch {
    return 'blocked';
  }
}

const NO_ANSWER = Symbol('no answer');
const TIMEOUT_MS = 5000;

/** 'blocked' only if the call rejects with an EwError whose code is EPERM. */
async function rejectsEperm(fn: () => Promise<unknown>): Promise<Verdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof NO_ANSWER>((resolve) => {
    timer = setTimeout(() => resolve(NO_ANSWER), TIMEOUT_MS);
  });
  try {
    await Promise.race([fn(), timeout]);
    return 'LEAK'; // it succeeded, or never answered (e.g. a dialog was shown)
  } catch (e) {
    return e instanceof EwError && e.code === 'EPERM' ? 'blocked' : 'LEAK';
  } finally {
    clearTimeout(timer);
  }
}

const results: Record<string, Verdict> = {
  parentDom: throws(() => window.parent.document),
  localStorage: throws(() => window.localStorage),
};
const [readHome, traversal, dialogNoPerm, forgedRef] = await Promise.all([
  rejectsEperm(() => os.fs.readText('/home/user/Documents/hello.txt')),
  rejectsEperm(() => os.fs.readText('/apps/self/../org.earlyweb.notepad/x')),
  rejectsEperm(() => os.dialog.open()),
  rejectsEperm(() => os.fs.readText({ id: 'g_0000000000000000', name: 'x' })),
]);
Object.assign(results, { readHome, traversal, dialogNoPerm, forgedRef });

// Written only once every check has settled.
const allBlocked = Object.values(results).every((v) => v === 'blocked');
(document.querySelector('#status') as HTMLElement).textContent = allBlocked
  ? 'All escape attempts were blocked.'
  : 'LEAK: at least one escape attempt was not blocked!';
(document.querySelector('#results') as HTMLElement).textContent = JSON.stringify(results);
await os.ready();
