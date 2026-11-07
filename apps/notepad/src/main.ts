import '@earlyweb/ui-kit/ui-kit.css';
import { connect, type FileRef } from '@earlyweb/sdk';

const os = await connect();
const editor = document.querySelector('#editor') as HTMLTextAreaElement;
let current: FileRef | null = null;
let dirty = false;

const refreshTitle = () => os.window.setTitle(`${dirty ? '*' : ''}${current?.name ?? 'Untitled'} - Notepad`);

async function openFile(file: FileRef) {
  editor.value = await os.fs.readText(file);
  current = file;
  dirty = false;
  refreshTitle();
}

async function save(): Promise<boolean> {
  current ??= await os.dialog.save({
    suggestedName: 'Untitled.txt',
    filters: [{ name: 'Text Documents', extensions: ['.txt'] }],
  });
  if (!current) return false; // user cancelled
  await os.fs.writeText(current, editor.value);
  dirty = false;
  refreshTitle();
  return true;
}

editor.addEventListener('input', () => {
  if (!dirty) {
    dirty = true;
    refreshTitle();
  }
});
document.querySelector('#open')?.addEventListener('click', async () => {
  const [file] = (await os.dialog.open({ filters: [{ name: 'Text', extensions: ['.txt'] }] })) ?? [];
  if (file) await openFile(file);
});
document.querySelector('#save')?.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    save();
  }
});

os.on('file.open', ({ file }) => openFile(file));
os.window.onBeforeClose(async () => {
  if (!dirty) return true;
  const choice = await os.dialog.message({
    title: 'Notepad',
    icon: 'warning',
    text: `Do you want to save changes to ${current?.name ?? 'Untitled'}?`,
    buttons: ['Save', "Don't Save", 'Cancel'],
  });
  if (choice === 'Cancel') return false;
  return choice === 'Save' ? save() : true;
});

if (os.launch.file) await openFile(os.launch.file);
refreshTitle();
await os.ready();
