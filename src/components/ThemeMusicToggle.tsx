import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Disc3, VolumeX } from 'lucide-react';
import type { ThemeMusic, ThemeMusicPreset, ThemeMusicSource, ThemeTemplate } from '../theme/types';
import { rhHiddenThemeMusicUrl } from '../theme/defaultTemplates';
import {
  GARDEN_THEME_MUSIC_AUTOPLAY_EVENT,
  type GardenThemeMusicAutoplayDetail,
} from '../theme/musicAutoplay';
import { useHiddenFeatureStore } from '../stores/hiddenFeatures';
import { useDragonBallRadarStore } from '../stores/dragonBallRadar';
import { useSaintSeiyaSanctuaryStore } from '../stores/saintSeiyaSanctuary';
import { localizeThemeMusicTitle } from '../i18n/themeCatalog';

interface ThemeMusicToggleProps {
  template: ThemeTemplate;
}

type Note = {
  freq: number;
  at: number;
  len: number;
  type?: OscillatorType;
};

type MidiNoteEvent = {
  tick: number;
  type: 'on' | 'off';
  channel: number;
  note: number;
  velocity: number;
};

type MidiTempoEvent = {
  tick: number;
  microsecondsPerQuarter: number;
};

type MidiScheduledNote = {
  midi: number;
  channel: number;
  start: number;
  duration: number;
  velocity: number;
};

type MidiSequence = {
  notes: MidiScheduledNote[];
  duration: number;
};

const MIDI_SEQUENCE_CACHE = new Map<string, Promise<MidiSequence>>();

const PRESET_NOTES: Record<ThemeMusicPreset, Note[]> = {
  'tech-pulse': [
    { freq: 220, at: 0, len: 0.12, type: 'sawtooth' },
    { freq: 330, at: 0.24, len: 0.09, type: 'triangle' },
    { freq: 277, at: 0.48, len: 0.12, type: 'sawtooth' },
    { freq: 440, at: 0.72, len: 0.1, type: 'triangle' },
    { freq: 392, at: 1.18, len: 0.14, type: 'sine' },
  ],
  'pixel-pop': [
    { freq: 523, at: 0, len: 0.08, type: 'square' },
    { freq: 659, at: 0.14, len: 0.08, type: 'square' },
    { freq: 784, at: 0.28, len: 0.08, type: 'square' },
    { freq: 1047, at: 0.42, len: 0.1, type: 'square' },
    { freq: 784, at: 0.62, len: 0.08, type: 'square' },
    { freq: 659, at: 0.76, len: 0.08, type: 'square' },
  ],
  'grand-line-adventure': [
    { freq: 392, at: 0, len: 0.18, type: 'triangle' },
    { freq: 494, at: 0.26, len: 0.16, type: 'triangle' },
    { freq: 587, at: 0.52, len: 0.18, type: 'triangle' },
    { freq: 659, at: 0.82, len: 0.2, type: 'sine' },
    { freq: 784, at: 1.18, len: 0.26, type: 'triangle' },
    { freq: 659, at: 1.62, len: 0.18, type: 'sine' },
  ],
  'rh-pulse': [
    { freq: 196, at: 0, len: 0.11, type: 'sine' },
    { freq: 294, at: 0.18, len: 0.08, type: 'triangle' },
    { freq: 392, at: 0.36, len: 0.08, type: 'triangle' },
    { freq: 523, at: 0.72, len: 0.11, type: 'sine' },
    { freq: 440, at: 1.08, len: 0.08, type: 'triangle' },
    { freq: 659, at: 1.34, len: 0.1, type: 'sine' },
  ],
  'shinobi-flame': [
    { freq: 147, at: 0, len: 0.08, type: 'sawtooth' },
    { freq: 220, at: 0.16, len: 0.08, type: 'square' },
    { freq: 294, at: 0.32, len: 0.1, type: 'sawtooth' },
    { freq: 440, at: 0.54, len: 0.1, type: 'triangle' },
    { freq: 392, at: 0.82, len: 0.08, type: 'square' },
    { freq: 587, at: 1.04, len: 0.12, type: 'sawtooth' },
    { freq: 784, at: 1.34, len: 0.16, type: 'triangle' },
  ],
  'eva-sync': [
    { freq: 110, at: 0, len: 0.08, type: 'sawtooth' },
    { freq: 165, at: 0.18, len: 0.08, type: 'square' },
    { freq: 220, at: 0.36, len: 0.1, type: 'sawtooth' },
    { freq: 330, at: 0.58, len: 0.11, type: 'triangle' },
    { freq: 247, at: 0.86, len: 0.08, type: 'square' },
    { freq: 494, at: 1.08, len: 0.12, type: 'sawtooth' },
    { freq: 659, at: 1.36, len: 0.18, type: 'triangle' },
  ],
  'spirit-gun': [
    { freq: 196, at: 0, len: 0.1, type: 'triangle' },
    { freq: 294, at: 0.18, len: 0.08, type: 'sawtooth' },
    { freq: 392, at: 0.36, len: 0.1, type: 'triangle' },
    { freq: 587, at: 0.62, len: 0.12, type: 'sine' },
    { freq: 784, at: 0.86, len: 0.12, type: 'triangle' },
    { freq: 988, at: 1.18, len: 0.16, type: 'sawtooth' },
    { freq: 740, at: 1.54, len: 0.14, type: 'sine' },
  ],
  'buzzer-beater': [
    { freq: 130, at: 0, len: 0.08, type: 'triangle' },
    { freq: 196, at: 0.18, len: 0.08, type: 'sine' },
    { freq: 262, at: 0.36, len: 0.09, type: 'triangle' },
    { freq: 330, at: 0.58, len: 0.1, type: 'sine' },
    { freq: 392, at: 0.82, len: 0.11, type: 'triangle' },
    { freq: 523, at: 1.08, len: 0.12, type: 'sine' },
    { freq: 392, at: 1.42, len: 0.1, type: 'square' },
    { freq: 659, at: 1.68, len: 0.16, type: 'triangle' },
  ],
  'golden-goal': [
    { freq: 196, at: 0, len: 0.08, type: 'triangle' },
    { freq: 294, at: 0.16, len: 0.08, type: 'sine' },
    { freq: 392, at: 0.32, len: 0.1, type: 'triangle' },
    { freq: 587, at: 0.56, len: 0.12, type: 'sine' },
    { freq: 523, at: 0.82, len: 0.09, type: 'triangle' },
    { freq: 659, at: 1.04, len: 0.13, type: 'sine' },
    { freq: 784, at: 1.34, len: 0.16, type: 'triangle' },
    { freq: 587, at: 1.72, len: 0.12, type: 'square' },
  ],
  'ki-burst': [
    { freq: 196, at: 0, len: 0.08, type: 'sawtooth' },
    { freq: 247, at: 0.12, len: 0.08, type: 'sawtooth' },
    { freq: 330, at: 0.24, len: 0.1, type: 'triangle' },
    { freq: 392, at: 0.38, len: 0.1, type: 'triangle' },
    { freq: 523, at: 0.58, len: 0.14, type: 'sine' },
    { freq: 659, at: 0.84, len: 0.16, type: 'triangle' },
    { freq: 784, at: 1.18, len: 0.18, type: 'sawtooth' },
    { freq: 988, at: 1.54, len: 0.18, type: 'sine' },
  ],
  'shenron-aura': [
    { freq: 98, at: 0, len: 0.42, type: 'sine' },
    { freq: 147, at: 0.32, len: 0.36, type: 'triangle' },
    { freq: 220, at: 0.66, len: 0.3, type: 'sine' },
    { freq: 392, at: 1.08, len: 0.18, type: 'triangle' },
    { freq: 523, at: 1.34, len: 0.2, type: 'sine' },
    { freq: 659, at: 1.72, len: 0.22, type: 'triangle' },
    { freq: 784, at: 2.12, len: 0.28, type: 'sine' },
  ],
  'pegasus-cosmos': [
    { freq: 196, at: 0, len: 0.08, type: 'triangle' },
    { freq: 294, at: 0.16, len: 0.08, type: 'sine' },
    { freq: 392, at: 0.32, len: 0.1, type: 'triangle' },
    { freq: 587, at: 0.56, len: 0.12, type: 'sine' },
    { freq: 784, at: 0.84, len: 0.12, type: 'triangle' },
    { freq: 988, at: 1.18, len: 0.16, type: 'sawtooth' },
    { freq: 740, at: 1.54, len: 0.14, type: 'sine' },
    { freq: 1175, at: 1.86, len: 0.18, type: 'triangle' },
  ],
  'hades-eclipse': [
    { freq: 82, at: 0, len: 0.5, type: 'sine' },
    { freq: 123, at: 0.36, len: 0.42, type: 'triangle' },
    { freq: 185, at: 0.72, len: 0.34, type: 'sine' },
    { freq: 277, at: 1.12, len: 0.22, type: 'triangle' },
    { freq: 415, at: 1.46, len: 0.22, type: 'sawtooth' },
    { freq: 622, at: 1.92, len: 0.28, type: 'sine' },
  ],
  'block-drop': [
    { freq: 330, at: 0, len: 0.07, type: 'square' },
    { freq: 392, at: 0.12, len: 0.07, type: 'square' },
    { freq: 494, at: 0.24, len: 0.07, type: 'square' },
    { freq: 659, at: 0.36, len: 0.09, type: 'square' },
    { freq: 523, at: 0.56, len: 0.07, type: 'triangle' },
    { freq: 392, at: 0.68, len: 0.07, type: 'square' },
    { freq: 247, at: 0.86, len: 0.12, type: 'sawtooth' },
    { freq: 988, at: 1.06, len: 0.08, type: 'square' },
  ],
  'farm-breeze': [
    { freq: 196, at: 0, len: 0.18, type: 'triangle' },
    { freq: 247, at: 0.26, len: 0.14, type: 'sine' },
    { freq: 294, at: 0.52, len: 0.16, type: 'triangle' },
    { freq: 392, at: 0.84, len: 0.18, type: 'sine' },
    { freq: 330, at: 1.18, len: 0.14, type: 'triangle' },
    { freq: 440, at: 1.46, len: 0.16, type: 'sine' },
    { freq: 523, at: 1.82, len: 0.2, type: 'triangle' },
    { freq: 392, at: 2.18, len: 0.18, type: 'sine' },
  ],
  'garden-march': [
    { freq: 196, at: 0, len: 0.12, type: 'triangle' },
    { freq: 262, at: 0.18, len: 0.1, type: 'sine' },
    { freq: 330, at: 0.36, len: 0.12, type: 'triangle' },
    { freq: 392, at: 0.58, len: 0.14, type: 'sine' },
    { freq: 330, at: 0.86, len: 0.1, type: 'triangle' },
    { freq: 494, at: 1.08, len: 0.16, type: 'sine' },
    { freq: 523, at: 1.42, len: 0.14, type: 'triangle' },
    { freq: 659, at: 1.72, len: 0.2, type: 'sine' },
    { freq: 392, at: 2.08, len: 0.16, type: 'triangle' },
  ],
};

const PRESET_LOOP_SECONDS: Record<ThemeMusicPreset, number> = {
  'tech-pulse': 1.75,
  'pixel-pop': 1.08,
  'grand-line-adventure': 2.15,
  'rh-pulse': 1.72,
  'shinobi-flame': 1.7,
  'eva-sync': 1.72,
  'spirit-gun': 1.92,
  'buzzer-beater': 2.08,
  'golden-goal': 2.08,
  'ki-burst': 1.96,
  'shenron-aura': 2.72,
  'pegasus-cosmos': 2.18,
  'hades-eclipse': 2.78,
  'block-drop': 1.32,
  'farm-breeze': 2.48,
  'garden-march': 2.46,
};

function clampVolume(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.16;
  return Math.max(0, Math.min(value, 0.5));
}

function scheduleNote(ctx: AudioContext, master: GainNode, note: Note, startAt: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = 0.012;
  const release = 0.045;
  const noteStart = startAt + note.at;
  const noteEnd = noteStart + note.len;

  oscillator.type = note.type || 'sine';
  oscillator.frequency.setValueAtTime(note.freq, noteStart);
  gain.gain.setValueAtTime(0.0001, noteStart);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), noteStart + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd + release);

  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(noteStart);
  oscillator.stop(noteEnd + release + 0.02);
}

function isMidiUrl(url: string) {
  return /\.(mid|midi)(?:[?#]|$)/i.test(url) || /^data:audio\/(?:midi|x-midi|mid)/i.test(url);
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  let output = '';
  for (let i = 0; i < length; i += 1) output += String.fromCharCode(bytes[offset + i] || 0);
  return output;
}

function readUInt16(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return (
    ((bytes[offset] || 0) * 0x1000000) +
    ((bytes[offset + 1] || 0) << 16) +
    ((bytes[offset + 2] || 0) << 8) +
    (bytes[offset + 3] || 0)
  );
}

function readVariableLength(bytes: Uint8Array, state: { offset: number }) {
  let value = 0;
  for (let i = 0; i < 4 && state.offset < bytes.length; i += 1) {
    const byte = bytes[state.offset] || 0;
    state.offset += 1;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return value;
}

function midiFrequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function parseMidiSequence(buffer: ArrayBuffer): MidiSequence {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 14 || readAscii(bytes, 0, 4) !== 'MThd') {
    throw new Error('Invalid MIDI header');
  }

  const headerLength = readUInt32(bytes, 4);
  const trackCount = readUInt16(bytes, 10);
  const division = readUInt16(bytes, 12);
  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE MIDI timing is not supported');
  }

  const ticksPerQuarter = Math.max(1, division);
  const noteEvents: MidiNoteEvent[] = [];
  const tempoEvents: MidiTempoEvent[] = [{ tick: 0, microsecondsPerQuarter: 500000 }];
  let offset = 8 + headerLength;
  let tracksRead = 0;

  while (offset + 8 <= bytes.length && tracksRead < trackCount) {
    const chunkType = readAscii(bytes, offset, 4);
    const chunkLength = readUInt32(bytes, offset + 4);
    offset += 8;
    const chunkEnd = Math.min(bytes.length, offset + chunkLength);
    if (chunkType !== 'MTrk') {
      offset = chunkEnd;
      continue;
    }
    tracksRead += 1;

    const state = { offset };
    let tick = 0;
    let runningStatus = 0;
    while (state.offset < chunkEnd) {
      tick += readVariableLength(bytes, state);
      if (state.offset >= chunkEnd) break;
      let status = bytes[state.offset] || 0;
      state.offset += 1;
      if (status < 0x80) {
        if (!runningStatus) break;
        state.offset -= 1;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }

      if (status === 0xff) {
        const metaType = bytes[state.offset] || 0;
        state.offset += 1;
        const length = readVariableLength(bytes, state);
        if (metaType === 0x51 && length >= 3 && state.offset + 2 < chunkEnd) {
          tempoEvents.push({
            tick,
            microsecondsPerQuarter:
              ((bytes[state.offset] || 0) << 16) |
              ((bytes[state.offset + 1] || 0) << 8) |
              (bytes[state.offset + 2] || 0),
          });
        }
        state.offset = Math.min(chunkEnd, state.offset + length);
        if (metaType === 0x2f) break;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const length = readVariableLength(bytes, state);
        state.offset = Math.min(chunkEnd, state.offset + length);
        runningStatus = 0;
        continue;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = bytes[state.offset] || 0;
      state.offset += 1;
      const needsSecondByte = eventType !== 0xc0 && eventType !== 0xd0;
      const data2 = needsSecondByte ? bytes[state.offset] || 0 : 0;
      if (needsSecondByte) state.offset += 1;

      if (eventType === 0x90 && data2 > 0) {
        noteEvents.push({ tick, type: 'on', channel, note: data1, velocity: data2 });
      } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
        noteEvents.push({ tick, type: 'off', channel, note: data1, velocity: 0 });
      }
    }
    offset = chunkEnd;
  }

  tempoEvents.sort((a, b) => a.tick - b.tick);
  const tickToSeconds = (targetTick: number) => {
    let seconds = 0;
    let previousTick = 0;
    let tempo = 500000;
    for (const event of tempoEvents) {
      if (event.tick > targetTick) break;
      seconds += ((event.tick - previousTick) * tempo) / (ticksPerQuarter * 1000000);
      previousTick = event.tick;
      tempo = event.microsecondsPerQuarter || tempo;
    }
    return seconds + ((targetTick - previousTick) * tempo) / (ticksPerQuarter * 1000000);
  };

  noteEvents.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
  const activeNotes = new Map<string, MidiNoteEvent[]>();
  const scheduledNotes: MidiScheduledNote[] = [];
  const lastTick = Math.max(0, ...noteEvents.map((event) => event.tick));

  for (const event of noteEvents) {
    const key = `${event.channel}:${event.note}`;
    if (event.type === 'on') {
      const queue = activeNotes.get(key) || [];
      queue.push(event);
      activeNotes.set(key, queue);
      continue;
    }
    const queue = activeNotes.get(key);
    const startEvent = queue?.shift();
    if (!startEvent) continue;
    const start = tickToSeconds(startEvent.tick);
    const end = tickToSeconds(Math.max(event.tick, startEvent.tick + 1));
    scheduledNotes.push({
      midi: startEvent.note,
      channel: startEvent.channel,
      start,
      duration: Math.max(0.04, end - start),
      velocity: startEvent.velocity,
    });
  }

  for (const queue of activeNotes.values()) {
    for (const startEvent of queue) {
      const start = tickToSeconds(startEvent.tick);
      const end = tickToSeconds(Math.max(lastTick, startEvent.tick + ticksPerQuarter));
      scheduledNotes.push({
        midi: startEvent.note,
        channel: startEvent.channel,
        start,
        duration: Math.max(0.08, end - start),
        velocity: startEvent.velocity,
      });
    }
  }

  scheduledNotes.sort((a, b) => a.start - b.start);
  const duration = Math.max(2, scheduledNotes.reduce((max, note) => Math.max(max, note.start + note.duration), 0) + 0.6);
  return { notes: scheduledNotes.slice(0, 6000), duration };
}

async function loadMidiSequence(url: string) {
  const cached = MIDI_SEQUENCE_CACHE.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load MIDI: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(parseMidiSequence);
  MIDI_SEQUENCE_CACHE.set(url, pending);
  return pending;
}

function scheduleMidiNote(ctx: AudioContext, master: GainNode, note: MidiScheduledNote, startAt: number, volume: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const noteStart = startAt + note.start;
  const duration = Math.max(0.04, Math.min(note.duration, note.channel === 9 ? 0.12 : 8));
  const noteEnd = noteStart + duration;
  const peak = Math.max(0.0001, volume * (note.velocity / 127) * (note.channel === 9 ? 0.12 : 0.24));

  oscillator.type = note.channel === 9 ? 'square' : note.midi < 48 ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(note.channel === 9 ? 70 + (note.midi % 24) * 10 : midiFrequency(note.midi), noteStart);
  gain.gain.setValueAtTime(0.0001, noteStart);
  gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd + 0.06);

  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(noteStart);
  oscillator.stop(noteEnd + 0.08);
}

export default function ThemeMusicToggle({ template }: ThemeMusicToggleProps) {
  const { t, i18n } = useTranslation('canvas');
  const [enabled, setEnabled] = useState(false);
  const rhDuckUploadIds = useHiddenFeatureStore((s) => s.rhDuckUploadIds);
  const yyhPortraitIds = useHiddenFeatureStore((s) => s.yyhPortraitIds);
  const shenronModeActive = useDragonBallRadarStore((s) => s.shenronModeActive);
  const hadesModeActive = useSaintSeiyaSanctuaryStore((s) => s.hadesModeActive);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const autoHiddenMusicRef = useRef(false);
  const autoGardenMusicRef = useRef(false);
  const gestureGardenTemplateRef = useRef<string | null>(null);
  const pendingGardenResumeRef = useRef(false);
  const enabledRef = useRef(false);

  const rhHiddenMusicActive = template.visuals?.style === 'rh' && rhDuckUploadIds.length > 0;
  const yyhHiddenMusicActive = template.visuals?.style === 'yyh' && yyhPortraitIds.length > 0;
  const shenronHiddenMusicActive = template.visuals?.style === 'dragon-ball' && shenronModeActive;
  const hadesHiddenMusicActive = template.visuals?.style === 'saint-seiya' && hadesModeActive;
  const hiddenMusicActive = rhHiddenMusicActive || yyhHiddenMusicActive || shenronHiddenMusicActive || hadesHiddenMusicActive;
  const gardenAutoPlayActive = template.visuals?.style === 'garden-defense';
  const music = useMemo(() => {
    const base = template.music;
    if (!hiddenMusicActive) return base;
    if (hadesHiddenMusicActive) {
      return {
        title: base?.hiddenTitle || '冥界篇',
        preset: 'hades-eclipse' as ThemeMusicPreset,
        source: (base?.hiddenUrl ? 'url' : 'synth') as ThemeMusicSource,
        url: base?.hiddenUrl,
        volume: base?.hiddenVolume ?? 0.18,
        bpm: 86,
        copyrightNote: base?.copyrightNote,
      };
    }
    if (shenronHiddenMusicActive) {
      return {
        title: base?.hiddenTitle || '神龙模式',
        preset: 'shenron-aura' as ThemeMusicPreset,
        source: (base?.hiddenUrl ? 'url' : 'synth') as ThemeMusicSource,
        url: base?.hiddenUrl,
        volume: base?.hiddenVolume ?? 0.2,
        bpm: 72,
        copyrightNote: base?.copyrightNote,
      };
    }
    if (yyhHiddenMusicActive) {
      return {
        title: base?.hiddenTitle || '幽游隐藏模式',
        preset: base?.preset || 'spirit-gun',
        source: (base?.hiddenUrl ? 'url' : base?.source || 'synth') as ThemeMusicSource,
        url: base?.hiddenUrl || base?.url,
        volume: base?.hiddenVolume ?? base?.volume ?? 0.18,
        bpm: base?.bpm,
        copyrightNote: base?.copyrightNote,
      };
    }
    return {
      title: base?.hiddenTitle || '沙耶之歌',
      preset: base?.preset || 'rh-pulse',
      source: 'url' as const,
      url: base?.hiddenUrl || rhHiddenThemeMusicUrl,
      volume: base?.hiddenVolume ?? base?.volume ?? 0.2,
      bpm: base?.bpm,
      copyrightNote: base?.copyrightNote,
    };
  }, [
    hiddenMusicActive,
    hadesHiddenMusicActive,
    rhHiddenMusicActive,
    shenronHiddenMusicActive,
    yyhHiddenMusicActive,
    template.music?.bpm,
    template.music?.copyrightNote,
    template.music?.hiddenTitle,
    template.music?.hiddenUrl,
    template.music?.hiddenVolume,
    template.music?.preset,
    template.music?.source,
    template.music?.title,
    template.music?.url,
    template.music?.volume,
  ]);

  const title = music?.title || 'Theme Music';
  const localizedTitle = localizeThemeMusicTitle(template, title, i18n.resolvedLanguage || i18n.language);
  const volume = clampVolume(music?.volume);
  const musicKey = `${template.id}|${rhHiddenMusicActive ? 'rh-hidden' : yyhHiddenMusicActive ? 'yyh-hidden' : shenronHiddenMusicActive ? 'shenron-hidden' : hadesHiddenMusicActive ? 'hades-hidden' : 'normal'}|${music?.preset || ''}|${music?.source || ''}|${music?.url || ''}|${volume}`;

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (masterGainRef.current) {
      masterGainRef.current.disconnect();
      masterGainRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  const playUrl = async (url: string, playbackVolume: number) => {
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = playbackVolume;
    audioRef.current = audio;
    await audio.play();
  };

  const playMidiUrl = async (url: string, playbackVolume: number) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor() as AudioContext;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterGainRef.current = master;
    if (ctx.state === 'suspended') await ctx.resume();

    const sequence = await loadMidiSequence(url);
    const playLoop = () => {
      if (audioCtxRef.current !== ctx) return;
      const startAt = ctx.currentTime + 0.04;
      sequence.notes.forEach((note) => scheduleMidiNote(ctx, master, note, startAt, playbackVolume));
    };

    playLoop();
    timerRef.current = window.setInterval(playLoop, Math.max(2, sequence.duration) * 1000);
  };

  const playSynth = async (playbackPreset: ThemeMusicPreset, playbackVolume: number) => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor() as AudioContext;
    const master = ctx.createGain();
    master.gain.value = 0.75;
    master.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterGainRef.current = master;
    if (ctx.state === 'suspended') await ctx.resume();

    const notes = PRESET_NOTES[playbackPreset] || PRESET_NOTES['tech-pulse'];
    const loopSeconds = PRESET_LOOP_SECONDS[playbackPreset] || PRESET_LOOP_SECONDS['tech-pulse'];
    const playLoop = () => {
      const startAt = ctx.currentTime + 0.015;
      notes.forEach((note) => scheduleNote(ctx, master, note, startAt, playbackVolume));
    };

    playLoop();
    timerRef.current = window.setInterval(playLoop, loopSeconds * 1000);
  };

  const playThemeMusic = async (targetMusic?: ThemeMusic): Promise<boolean> => {
    stop();
    const playbackVolume = clampVolume(targetMusic?.volume);
    const playbackPreset = targetMusic?.preset || 'tech-pulse';
    try {
      if ((targetMusic?.source === 'url' || targetMusic?.source === 'upload') && targetMusic.url?.trim()) {
        const url = targetMusic.url.trim();
        if (isMidiUrl(url)) {
          await playMidiUrl(url, playbackVolume);
        } else {
          await playUrl(url, playbackVolume);
        }
      } else {
        await playSynth(playbackPreset, playbackVolume);
      }
      setEnabled(true);
      enabledRef.current = true;
      return true;
    } catch (error) {
      stop();
      setEnabled(false);
      enabledRef.current = false;
      console.warn('[theme-music] unable to start theme music', error);
      return false;
    }
  };

  const playCurrentMusic = () => playThemeMusic(music);

  useEffect(() => {
    const handleGardenAutoplay = (event: Event) => {
      const detail = (event as CustomEvent<GardenThemeMusicAutoplayDetail>).detail;
      if (!detail?.templateId) return;

      const wasPlaying = enabledRef.current;
      autoGardenMusicRef.current = !wasPlaying;
      pendingGardenResumeRef.current = false;
      gestureGardenTemplateRef.current = detail.templateId;
      void playThemeMusic(detail.music).then((started) => {
        pendingGardenResumeRef.current = !started;
        if (!started && gestureGardenTemplateRef.current === detail.templateId) {
          gestureGardenTemplateRef.current = null;
        }
      });
    };

    window.addEventListener(GARDEN_THEME_MUSIC_AUTOPLAY_EVENT, handleGardenAutoplay);
    return () => window.removeEventListener(GARDEN_THEME_MUSIC_AUTOPLAY_EVENT, handleGardenAutoplay);
  }, [musicKey]);

  const toggle = async () => {
    autoHiddenMusicRef.current = false;
    autoGardenMusicRef.current = false;
    gestureGardenTemplateRef.current = null;
    pendingGardenResumeRef.current = false;
    if (enabled) {
      stop();
      setEnabled(false);
      enabledRef.current = false;
      return;
    }
    await playCurrentMusic();
  };

  useEffect(() => {
    const wasPlaying = enabledRef.current;
    const gesturePlaybackActive = gardenAutoPlayActive
      && gestureGardenTemplateRef.current === template.id
      && Boolean(audioRef.current || audioCtxRef.current);
    if (gesturePlaybackActive) {
      gestureGardenTemplateRef.current = null;
      pendingGardenResumeRef.current = false;
      return stop;
    }

    stop();
    pendingGardenResumeRef.current = false;
    if (hiddenMusicActive) {
      autoHiddenMusicRef.current = !wasPlaying;
      void playCurrentMusic();
      return stop;
    }

    if (gardenAutoPlayActive) {
      autoGardenMusicRef.current = !wasPlaying;
      pendingGardenResumeRef.current = true;
      void playCurrentMusic().then((started) => {
        pendingGardenResumeRef.current = !started;
      });
      return stop;
    }

    if (wasPlaying && !autoHiddenMusicRef.current && !autoGardenMusicRef.current) {
      void playCurrentMusic();
    } else {
      setEnabled(false);
      enabledRef.current = false;
    }
    autoHiddenMusicRef.current = false;
    autoGardenMusicRef.current = false;
    return stop;
  }, [musicKey]);

  useEffect(() => {
    if (!gardenAutoPlayActive) {
      pendingGardenResumeRef.current = false;
      return;
    }

    const resumeGardenMusic = (event: Event) => {
      if (!pendingGardenResumeRef.current || enabledRef.current) return;
      if (event.target instanceof Element && event.target.closest('.t8-theme-music-toggle')) return;

      pendingGardenResumeRef.current = false;
      void playCurrentMusic().then((started) => {
        pendingGardenResumeRef.current = !started;
      });
    };

    document.addEventListener('pointerdown', resumeGardenMusic, true);
    document.addEventListener('keydown', resumeGardenMusic, true);
    return () => {
      document.removeEventListener('pointerdown', resumeGardenMusic, true);
      document.removeEventListener('keydown', resumeGardenMusic, true);
    };
  }, [gardenAutoPlayActive, musicKey]);

  return (
    <button
      type="button"
      className={`t8-theme-music-toggle nodrag nopan ${enabled ? 'is-playing' : ''}`}
      onClick={toggle}
      title={enabled ? t('controls.themeMusicStop', { title: localizedTitle }) : t('controls.themeMusicPlay', { title: localizedTitle })}
      aria-label={enabled ? t('controls.themeMusicStop', { title: localizedTitle }) : t('controls.themeMusicPlay', { title: localizedTitle })}
      aria-pressed={enabled}
    >
      {enabled ? <Disc3 size={18} /> : <VolumeX size={18} />}
    </button>
  );
}
