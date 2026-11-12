#!/usr/bin/env .venv/bin/python
"""
Process video transcripts and fill in concept timestamps.

Order: prob, la, ds, algo, db, ga, then the rest
Max 40 videos per run.
Sleep 30s between transcript fetches.
Stop immediately on IpBlocked, RequestBlocked, or 429.
Set note='no transcript' for TranscriptsDisabled videos.
"""

import json
import os
import sys
import subprocess
import time
import re
from youtube_transcript_api import YouTubeTranscriptApi as Y
from youtube_transcript_api._errors import IpBlocked, RequestBlocked, TranscriptsDisabled

VIDEOS_DIR = 'videos'
INPUTS_DIR = 'inputs'
SUBS_DIR = 'subs'

# Processing order: prefix -> display name
ORDER = ['prob', 'la', 'ds', 'algo', 'db', 'ga']

# Max videos per run
MAX_VIDEOS = 40


def list_video_files():
    """List all video JSON files, returning (filename, topic_id) pairs."""
    files = []
    for f in sorted(os.listdir(VIDEOS_DIR)):
        if f.endswith('.json'):
            topic_id = f[:-5]  # remove .json
            files.append((f, topic_id))
    return files


def get_video_data(topic_id):
    """Load video data for a given topic_id."""
    filepath = os.path.join(VIDEOS_DIR, f'{topic_id}.json')
    if not os.path.exists(filepath):
        return None
    with open(filepath) as f:
        return json.load(f)


def get_atoms(topic_id):
    """Load atom data for a given topic_id."""
    filepath = os.path.join(INPUTS_DIR, f'{topic_id}.json')
    if not os.path.exists(filepath):
        return None
    with open(filepath) as f:
        data = json.load(f)
    return data.get('atoms', [])


def get_atom_id_by_name(atoms, name_pattern):
    """Find atom id by matching name/one_line pattern."""
    for atom in atoms:
        atom_id = atom.get('id', '')
        name = atom.get('name', '')
        one_line = atom.get('one_line', '')
        # Check if name or one_line contains the pattern
        if name_pattern.lower() in name.lower() or name_pattern.lower() in one_line.lower():
            return atom_id
    return None


def find_atom_start_time(transcript_atoms, atoms_list):
    """
    For each atom in transcript_atoms, find the earliest start time
    where a matching atom from atoms_list is explained.
    
    transcript_atoms: list of [start, text] from the transcript
    atoms_list: list of atom dicts with id, name, one_line
    
    Returns: dict of {atom_id: start_s} for matched atoms
    """
    # Build a mapping of atom_id -> start time
    atom_starts = {}
    
    # For each atom, try to find it in the transcript
    for atom in atoms_list:
        atom_id = atom.get('id', '')
        one_line = atom.get('one_line', '')
        name = atom.get('name', '')
        
        if not one_line and not name:
            continue
        
        # Search transcript for matching text
        best_start = None
        best_score = -1
        
        for entry in transcript_atoms:
            start_s = entry[0]
            text = entry[1]
            
            # Check if one_line or name keywords appear in transcript text
            score = 0
            text_lower = text.lower()
            
            # Match one_line keywords
            if one_line:
                one_line_words = [w for w in one_line.lower().split() if len(w) > 3]
                for word in one_line_words:
                    if word in text_lower:
                        score += 1
            
            # Match name
            if name:
                name_words = [w for w in name.lower().split() if len(w) > 3]
                for word in name_words:
                    if word in text_lower:
                        score += 1
            
            if score > best_score:
                best_score = score
                best_start = start_s
        
        if best_start is not None and best_score > 0:
            atom_starts[atom_id] = best_start
    
    return atom_starts


def fetch_transcript(video_id):
    """
    Fetch transcript for a video using the youtube_transcript_api.
    Returns (transcript_entries, error_type, error_message).
    transcript_entries is a list of [start, text] pairs.
    error_type is one of: 'ok', 'transcripts_disabled', 'ip_blocked', 'other'
    """
    try:
        # Try fetching with available languages
        t = Y().fetch(video_id, languages=['en', 'hi', 'en-IN'])
        entries = [[round(s.start), s.text] for s in t.snippets]
        return entries, 'ok', None
    except IpBlocked:
        return None, 'ip_blocked', 'IpBlocked'
    except RequestBlocked:
        return None, 'request_blocked', 'RequestBlocked'
    except TranscriptsDisabled:
        return None, 'transcripts_disabled', 'TranscriptsDisabled'
    except Exception as e:
        # Check if it's a transcript-related error
        error_str = str(e).lower()
        if 'disabled' in error_str or 'no transcript' in error_str:
            return None, 'transcripts_disabled', str(e)
        return None, 'other', str(e)


def update_video_concepts(topic_id, video_id, atoms, atom_starts):
    """
    Update a video's concepts with atom start times.
    Returns the updated video data.
    """
    video = get_video_data(topic_id)
    if video is None:
        print(f"  ERROR: Could not load video data for {topic_id}")
        return None
    
    # Get existing concepts or start fresh
    concepts = video.get('concepts', [])
    
    # Build new concepts from atoms
    new_concepts = []
    for atom in atoms:
        atom_id = atom.get('id', '')
        start_s = atom_starts.get(atom_id)
        note = ""
        
        if start_s is not None:
            new_concepts.append({
                "atom_id": atom_id,
                "start_s": start_s,
                "note": note
            })
        else:
            # Atom not found in transcript - skip or add with note
            new_concepts.append({
                "atom_id": atom_id,
                "start_s": 0,
                "note": "timestamp_unavailable"
            })
    
    # Replace concepts
    video['concepts'] = new_concepts
    video.pop('note', None)  # Remove "timestamps pending" note
    
    return video


def main():
    # Determine which videos need processing
    video_files = list_video_files()
    
    # Identify videos needing processing (empty concepts OR note='timestamps pending' OR 'no transcript')
    needs_processing = []
    
    for vf, topic_id in video_files:
        video = get_video_data(topic_id)
        if video is None:
            continue
        
        concepts = video.get('concepts', [])
        note = video.get('note', '')
        
        concepts_empty = len(concepts) == 0
        note_pending = note == 'timestamps pending'
        note_no_transcript = note == 'no transcript'
        
        if concepts_empty or note_pending or note_no_transcript:
            needs_processing.append({
                'file': vf,
                'topic_id': topic_id,
                'video': video,
                'id': video.get('id', 'unknown'),
                'concepts_empty': concepts_empty,
                'note_pending': note_pending,
                'note_no_transcript': note_no_transcript
            })
    
    # Sort by order: prob, la, ds, algo, db, ga, then rest
    ordered = {o: [] for o in ORDER}
    rest = []
    
    for item in needs_processing:
        # Extract topic prefix
        parts = item['topic_id'].split('.')
        prefix = parts[0] if parts else ''
        if prefix in ordered:
            ordered[prefix].append(item)
        else:
            rest.append(item)
    
    # Build the processing list in order
    processing_list = []
    for o in ORDER:
        processing_list.extend(ordered[o])
    processing_list.extend(rest)
    
    # Limit to max 40 videos
    processing_list = processing_list[:MAX_VIDEOS]
    
    print(f"Total videos needing processing: {len(needs_processing)}")
    print(f"Will process {len(processing_list)} videos this run")
    for item in processing_list:
        print(f"  {item['id']}: topic={item['topic_id']}, note={item['video'].get('note')}, concepts_empty={item['concepts_empty']}")
    
    # Process each video
    for i, item in enumerate(processing_list):
        vid_id = item['id']
        topic_id = item['topic_id']
        
        print(f"\n[{i+1}/{len(processing_list)}] Processing {vid_id} (topic: {topic_id})")
        
        # Step 1: Check if transcript already exists in subs/
        subs_file = os.path.join(SUBS_DIR, f'{vid_id}.json')
        
        transcript_entries = None
        transcript_error = None
        
        if os.path.exists(subs_file):
            print(f"  Reusing existing transcript: {subs_file}")
            with open(subs_file) as f:
                existing = json.load(f)
            # existing could be list or dict
            if isinstance(existing, list):
                transcript_entries = existing
            elif isinstance(existing, dict) and 'note' in existing:
                # This is a "no transcript" marker
                transcript_error = 'transcripts_disabled'
                print(f"  Existing transcript has note: {existing.get('note')}")
        else:
            print(f"  Fetching transcript for {vid_id}...")
            # Step 1a: Fetch transcript
            transcript_entries, error_type, error_msg = fetch_transcript(vid_id)
            
            if error_type == 'ip_blocked' or error_type == 'request_blocked':
                print(f"  FATAL: {error_msg} - stopping entire run immediately")
                print("  It will be retried tomorrow.")
                sys.exit(1)
            elif error_type == 'transcripts_disabled':
                print(f"  No transcript available: setting note='no transcript'")
                transcript_error = 'transcripts_disabled'
                # Create a marker file indicating no transcript
                os.makedirs(SUBS_DIR, exist_ok=True)
                with open(subs_file, 'w') as f:
                    json.dump({'note': 'no transcript', 'yt_id': vid_id}, f)
                transcript_error = 'transcripts_disabled'
            elif error_type == 'ok':
                # Save transcript
                os.makedirs(SUBS_DIR, exist_ok=True)
                with open(subs_file, 'w') as f:
                    json.dump(transcript_entries, f)
                print(f"  Saved transcript with {len(transcript_entries)} entries")
            else:
                print(f"  Error fetching transcript: {error_msg}")
                transcript_error = 'other'
        
        # Step 2: Get atom list and find start times
        atoms = get_atoms(topic_id)
        if atoms is None:
            print(f"  WARNING: No atom list found for {topic_id}, skipping concepts update")
            continue
        
        print(f"  Atoms: {len(atoms)}")
        
        # Find start times for each atom
        if transcript_entries is not None:
            atom_starts = find_atom_start_time(transcript_entries, atoms)
        else:
            atom_starts = {}
            print(f"  No transcript available, all timestamps will be unavailable")
        
        # Step 3: Update video concepts
        updated_video = update_video_concepts(topic_id, vid_id, atoms, atom_starts)
        
        if updated_video is None:
            print(f"  ERROR: Could not update video concepts")
            continue
        
        # Write the JSON file back immediately
        output_path = os.path.join(VIDEOS_DIR, item['file'])
        with open(output_path, 'w') as f:
            json.dump(updated_video, f, indent=2)
        
        print(f"  Updated {output_path}")
        print(f"  Concepts: {len(updated_video.get('concepts', []))} entries")
        for c in updated_video.get('concepts', [])[:3]:
            print(f"    - {c.get('atom_id')}: start_s={c.get('start_s')}, note={c.get('note')}")
        
        # Sleep 30s between transcript fetches (not for the first iteration if we reused)
        if i < len(processing_list) - 1:
            print(f"  Sleeping 30s before next transcript fetch...")
            time.sleep(30)
    
    print(f"\nDone! Processed {len(processing_list)} videos.")


if __name__ == '__main__':
    main()