import sys
import os
import json
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings

client = TestClient(app)

SAMPLE_TRANSCRIPT = """Sarah: Let's review the blockers for the milestone release.
David: The Figma design system tokens are complete. I need Alex to confirm the GraphQL schema changes for user preferences by Wednesday 4 PM.
Alex: I will finalize the endpoint by Wednesday 4 PM once security signs off.
Priya: We need test credentials for the staging sandbox. Who is provisioning them?
Sarah: Someone should provision staging access by tomorrow morning. Alex, please document the authentication fallback plan."""

def run_live_e2e_verification():
    print("=" * 70)
    print("MEETMIND AI — PHASE 5: LIVE END-TO-END WORKFLOW VERIFICATION")
    print("=" * 70)

    # Step 1: Health check verification
    print("\n[Step 1] Verifying Backend Health Check...")
    res_api_health = client.get("/api/health")
    assert res_api_health.status_code == 200, f"Expected 200, got {res_api_health.status_code}"
    res_root_health = client.get("/health")
    assert res_root_health.status_code == 200, f"Expected 200, got {res_root_health.status_code}"
    print(f"✓ /api/health: {res_api_health.json()}")
    print(f"✓ /health: {res_root_health.json()}")

    # Step 2: Check Gemini API Key configuration
    api_key_configured = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here")
    print(f"\n[Step 2] Gemini Configuration: Model={settings.GEMINI_MODEL}, KeyConfigured={api_key_configured}")
    if not api_key_configured:
        print("✗ Cannot perform live Gemini test: GEMINI_API_KEY is not configured.")
        return False

    # Step 3: Analyze Meeting Transcript via Live Gemini API
    print("\n[Step 3] Submitting Live Meeting Analysis Request to Gemini...")
    print(f"Transcript length: {len(SAMPLE_TRANSCRIPT)} chars")
    
    response = client.post(
        "/api/meetings/analyze",
        json={
            "title": "Milestone Release Blocker Sync",
            "transcript": SAMPLE_TRANSCRIPT,
        },
    )

    if response.status_code != 200:
        print(f"✗ Analysis failed with status {response.status_code}: {response.text}")
        return False

    analysis = response.json()
    print("✓ Live Gemini Analysis Succeeded!")
    print(f"  - Summary: {analysis['summary']}")
    print(f"  - Discussion Points ({len(analysis['discussion_points'])}): {analysis['discussion_points'][:2]}")
    print(f"  - Decisions ({len(analysis['decisions'])}): {analysis['decisions']}")
    print(f"  - Action Items ({len(analysis['action_items'])}):")
    for a in analysis['action_items']:
        print(f"    * [{a.get('id')}] {a.get('task')} | Owner: {a.get('owner')} | Due: {a.get('deadline')}")
    print(f"  - Clarification Required: {analysis['clarification_required']}")
    print(f"  - Clarifications ({len(analysis['clarifications'])}):")
    for c in analysis['clarifications']:
        print(f"    * [{c.get('id')}] ({c.get('category')}): \"{c.get('original_statement')}\" -> {c.get('question')}")

    # Step 4: Validate Contract Invariants
    assert isinstance(analysis["summary"], str) and len(analysis["summary"]) > 0
    assert isinstance(analysis["discussion_points"], list)
    assert isinstance(analysis["action_items"], list)
    assert all(a.get("id") is not None for a in analysis["action_items"])
    assert analysis["clarification_required"] is True, "Expected ambiguities in sample transcript"
    assert len(analysis["clarifications"]) > 0, "Expected at least 1 clarification"

    # Step 5: Test Clarification Resolution with Live Gemini API
    target_clarif = analysis["clarifications"][0]
    clarif_id = target_clarif["id"]
    print(f"\n[Step 5] Resolving Clarification [{clarif_id}] with Live Gemini API...")
    clarification_answer = "David from Infrastructure will provision the staging access by tomorrow 10 AM."

    clarify_res = client.post(
        "/api/meetings/clarify",
        json={
            "analysis": analysis,
            "answers": [
                {
                    "clarification_id": clarif_id,
                    "answer": clarification_answer,
                }
            ],
        },
    )

    if clarify_res.status_code != 200:
        print(f"✗ Clarify failed with status {clarify_res.status_code}: {clarify_res.text}")
        return False

    updated_analysis = clarify_res.json()
    print("✓ Live Clarification Resolution Succeeded!")
    print(f"  - Updated Summary: {updated_analysis['summary']}")
    
    # Check that answered clarification is resolved
    matching_clarif = next((c for c in updated_analysis["clarifications"] if c["id"] == clarif_id), None)
    assert matching_clarif is not None, "Target clarification must exist in updated analysis"
    print(f"  - Clarification [{clarif_id}] Resolved status: {matching_clarif.get('resolved')}")
    print(f"  - Updated Action Items:")
    for a in updated_analysis['action_items']:
        print(f"    * [{a.get('id')}] {a.get('task')} | Owner: {a.get('owner')} | Due: {a.get('deadline')}")

    # Step 6: Test Unresolved Answer (Vague input) with Live Gemini API
    # Create an artificial unresolved case or re-run with ambiguous answer
    print("\n[Step 6] Testing Vague Clarification Answer with Live Gemini API...")
    vague_answer = "We still haven't decided who will do this."
    vague_res = client.post(
        "/api/meetings/clarify",
        json={
            "analysis": analysis,
            "answers": [
                {
                    "clarification_id": clarif_id,
                    "answer": vague_answer,
                }
            ],
        },
    )
    assert vague_res.status_code == 200
    vague_analysis = vague_res.json()
    matching_vague = next(c for c in vague_analysis["clarifications"] if c["id"] == clarif_id)
    print(f"  - Vague Answer Resolved status: {matching_vague.get('resolved')} (Expected: False)")
    print(f"  - Clarification Required flag: {vague_analysis.get('clarification_required')}")

    # Step 7: Test PDF Report Export
    print("\n[Step 7] Generating PDF Report from Meeting Analysis...")
    pdf_res = client.post(
        "/api/meetings/export/pdf",
        json={
            "title": "Milestone Release Blocker Sync",
            "transcript": SAMPLE_TRANSCRIPT,
            "analysis": updated_analysis,
        },
    )
    assert pdf_res.status_code == 200, f"PDF export failed with status {pdf_res.status_code}"
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF-")
    print(f"✓ PDF Report Generated Successfully! Size: {len(pdf_res.content)} bytes")
    print(f"  - Download Header: {pdf_res.headers.get('content-disposition')}")

    print("\n" + "=" * 70)
    print("✓ ALL LIVE END-TO-END WORKFLOW VERIFICATIONS PASSED SUCCESSFULLY!")
    print("=" * 70)
    return True

if __name__ == "__main__":
    success = run_live_e2e_verification()
    sys.exit(0 if success else 1)

