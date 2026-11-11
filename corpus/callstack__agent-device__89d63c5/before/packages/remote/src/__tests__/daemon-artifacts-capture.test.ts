import { expect, test } from 'vitest';
import { createTestHostEnvironment } from '@agent-device/test-kit';
import { prepareRemoteRequestArtifacts } from '../daemon-artifacts.ts';

const remote = { baseUrl: 'http://remote.example.test/agent-device', token: 'secret' };
const signal = new AbortController().signal;

test.each([
  {
    command: 'perf',
    positionals: ['memory', 'snapshot'],
    flags: { out: 'heap.hprof' },
    expected: '/client/heap.hprof',
  },
  {
    command: 'perf',
    positionals: ['cpu', 'profile', 'report', 'simpleperf', '', 'cpu.json'],
    expected: '/client/cpu.json',
  },
  {
    command: 'perf',
    positionals: ['trace', 'stop', 'perfetto', '', 'trace.data'],
    expected: '/client/trace.data',
  },
  { command: 'trace', positionals: ['start', './capture.log'], expected: '/client/capture.log' },
  { command: 'trace', positionals: ['stop', 'trace.log'], expected: '/client/trace.log' },
  {
    command: 'trace',
    positionals: ['start'],
    flags: { out: 'capture.log' },
    expected: '/client/capture.log',
  },
])(
  'remote $command destinations remain client download metadata',
  async ({ command, positionals, flags, expected }) => {
    const prepared = await prepareRemoteRequestArtifacts(
      {
        command,
        session: 'capture',
        positionals,
        flags,
        meta: { cwd: '/client' },
      },
      remote,
      signal,
      createTestHostEnvironment(),
    );
    expect(prepared.clientArtifactPaths?.outPath).toBe(expected);
  },
);

test('a remote performance observation without an output does not invent a client destination', async () => {
  const prepared = await prepareRemoteRequestArtifacts(
    {
      command: 'perf',
      session: 'capture',
      positionals: ['frames'],
    },
    remote,
    signal,
    createTestHostEnvironment(),
  );
  expect(prepared.clientArtifactPaths).toBeUndefined();
});
