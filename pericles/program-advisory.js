'use strict';

const AGE_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function childAge(text) {
  const match = text.match(/\b(?:child|kid|son|daughter|he|she|they)\s+(?:is|are|aged?)\s+(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]year[- ]old\b|\bage\s+(\d{1,2})\b/i);
  const value = match && (match[1] || match[2] || match[3]).toLowerCase();
  return value == null ? null : /^\d+$/.test(value) ? Number(value) : AGE_WORDS.indexOf(value);
}
function recommendPrograms(message, events, previous = null) {
  const age = childAge(message) ?? previous?.age ?? null;
  if (age === null) return null;
  const interests = /\b(?:build\w*|robot\w*|mak\w*|design|STEM|science)\b/i.test(message) ? 'making'
    : /\b(?:read\w*|phonics|stories|story|books?)\b/i.test(message) ? 'reading'
    : /\b(?:math|homework|study|writing)\b/i.test(message) ? 'homework' : previous?.interests || null;
  const seen = new Set();
  const fits = events.filter(e => {
    if (seen.has(e.id) || !Number.isInteger(e.minAge) || age < e.minAge || age > e.maxAge || e.remaining <= 0) return false;
    seen.add(e.id);
    return true;
  }).sort((a, b) => {
    const score = e => (e.id === 'storytime' && age <= 7 ? 5 : e.id === 'reading-lab' ? 4 : e.id === 'maker-play' ? 3 : e.id === 'homework-studio' ? 2 : 0)
      + (interests === 'reading' && /storytime|reading-lab/.test(e.id) ? 5 : interests === 'homework' && e.id === 'homework-studio' ? 10 : interests === 'making' && /maker-start|maker-play/.test(e.id) ? 10 : 0);
    return score(b) - score(a);
  }).slice(0, 3);
  const date = e => {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${e.date}T12:00:00Z`));
    const [h, m] = e.time.split(':').map(Number);
    return `${day} at ${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const why = e => e.id === 'storytime' ? 'a playful option for enjoying stories, songs, and new words together'
    : e.id === 'reading-lab' ? 'a good choice if you want extra practice with sounds, words, and understanding stories'
    : e.id === 'homework-studio' ? 'useful for help with a particular school task, rather than a general play session'
    : e.id === 'maker-start' ? 'a hands-on introduction to designing a simple object with a caregiver'
    : e.id === 'maker-play' ? 'a playful building session with blocks and cardboard, suited to trying ideas together'
    : e.description;
  let reply = fits.length ? `For a ${age}-year-old, I’d ${interests === 'making' && age < 8 ? 'start with these age-appropriate options' : 'suggest these options'}:\n\n${fits.map(e => `- ${e.title} — ${why(e)}. Next session: ${date(e)}. Ages ${e.minAge}–${e.maxAge}${e.caregiverRequired ? '; attend with a caregiver' : ''}.`).join('\n')}`
    : `I don’t have a dated program for age ${age} in the next two weeks. I can still help you plan an activity around what they enjoy.`;
  if (interests === 'making' && age < 8) reply += '\n\nThe 3D-printing workshop currently starts at age 8 on our schedule, so I wouldn’t recommend booking it for them yet.';
  reply += '\n\nTimes are local to the library. ';
  reply += interests ? 'Would you like to know more about one of these?' : 'What do they enjoy most—stories, making things, or games?';
  return { reply, profile: { age, interests }, options: fits };
}
module.exports = { childAge, recommendPrograms };
