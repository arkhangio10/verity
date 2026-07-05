import { describe, expect, it } from 'vitest';
import { factAgreement, RunAbortedError, Trace } from '@covenant/agent';

describe('reasoning trace', () => {
  it('assigns monotonic sequence numbers and forwards events', () => {
    const seen: number[] = [];
    const trace = new Trace('run-1', (ev) => seen.push(ev.seq));
    trace.note('first');
    trace.warning('second');
    trace.decision('third', 'detail');
    expect(seen).toEqual([0, 1, 2]);
    expect(trace.events.every((ev) => ev.runId === 'run-1')).toBe(true);
  });

  it('attaches the current step to events emitted inside it', () => {
    const trace = new Trace('run-2');
    trace.beginStep({ id: 'compute', title: 'Compute', description: '' });
    trace.note('inside step');
    trace.endStep();
    trace.note('outside step');
    const notes = trace.events.filter((e) => e.type === 'note');
    expect(notes[0]?.type === 'note' && notes[0].stepId).toBe('compute');
    expect(notes[1]?.type === 'note' && notes[1].stepId).toBeUndefined();
  });

  it('mint unique tool call ids', () => {
    const trace = new Trace('run-3');
    expect(trace.nextCallId('ratio_calculator')).toBe('ratio_calculator#1');
    expect(trace.nextCallId('ratio_calculator')).toBe('ratio_calculator#2');
  });

  it('honors abort signals between steps', () => {
    const controller = new AbortController();
    const trace = new Trace('run-4', undefined, controller.signal);
    controller.abort();
    expect(() => trace.checkAborted()).toThrowError(RunAbortedError);
  });
});

describe('multi-sample fact agreement (consistency signal)', () => {
  it('identical fact usage → 1', () => {
    expect(factAgreement('{{fact:a}} and {{fact:b}}', '{{fact:b}} then {{fact:a}}')).toBe(1);
  });
  it('disjoint fact usage → 0', () => {
    expect(factAgreement('{{fact:a}}', '{{fact:b}}')).toBe(0);
  });
  it('partial overlap in between', () => {
    expect(factAgreement('{{fact:a}} {{fact:b}}', '{{fact:b}} {{fact:c}}')).toBeCloseTo(1 / 3, 10);
  });
  it('no facts at all counts as agreement', () => {
    expect(factAgreement('no facts here', 'none here either')).toBe(1);
  });
});
