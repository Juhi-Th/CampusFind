"""
CampusFind - Database Search Engine for CampusFind AI
Safe, ORM-based search across lost and found items.
"""

from datetime import datetime, date, timedelta
from django.db.models import Q
from .models import Item

# Common English stop-words to filter when extracting search keywords
STOP_WORDS = {
    "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "up", "about", "into", "over", "after", "is",
    "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "i", "me", "my", "myself", "we", "our", "you",
    "your", "he", "him", "his", "she", "her", "it", "its", "they", "them",
    "this", "that", "these", "those", "lost", "found", "find", "looking",
    "someone", "anyone", "item", "something", "near", "around"
}

VALID_CATEGORIES = {
    "electronics": "Electronics",
    "electronic": "Electronics",
    "phone": "Electronics",
    "laptop": "Electronics",
    "charger": "Electronics",
    "headphone": "Electronics",
    "headphones": "Electronics",
    "earbuds": "Electronics",
    "id cards": "ID Cards",
    "id card": "ID Cards",
    "card": "ID Cards",
    "student id": "ID Cards",
    "books & notes": "Books & Notes",
    "books": "Books & Notes",
    "book": "Books & Notes",
    "notes": "Books & Notes",
    "notebook": "Books & Notes",
    "keys": "Keys",
    "key": "Keys",
    "keychain": "Keys",
    "accessories": "Accessories",
    "accessory": "Accessories",
    "bottle": "Accessories",
    "water bottle": "Accessories",
    "bag": "Accessories",
    "backpack": "Accessories",
    "umbrella": "Accessories",
    "wallet": "Accessories",
    "watch": "Accessories",
    "glasses": "Accessories",
}


def normalize_category(category_input: str) -> str:
    """Normalize user or model category string to exact model choice."""
    if not category_input:
        return ""
    cat_lower = category_input.strip().lower()
    return VALID_CATEGORIES.get(cat_lower, category_input.strip())


def search_campus_items(
    query: str = "",
    item_type: str = "all",
    category: str = "",
    location: str = "",
    days_back: int = None,
    limit: int = 5
) -> dict:
    """
    Search the Item model in PostgreSQL using safe Django ORM queries.

    Args:
        query: Free-text search string (e.g. 'black water bottle', 'student ID')
        item_type: 'lost', 'found', or 'all'
        category: Item category to filter by
        location: Campus location keyword (e.g. 'Library', 'Cafeteria')
        days_back: Optional number of days to search back
        limit: Max number of items to return (default 5, capped at 10)

    Returns:
        dict: Safe, sanitized summary dictionary of matching items without private info.
    """
    qs = Item.objects.all()

    # 1. Filter by item_type ('lost' or 'found')
    if item_type:
        clean_type = item_type.strip().lower()
        if clean_type in ("lost", "found"):
            qs = qs.filter(item_type=clean_type)

    # 2. Filter by category
    norm_cat = normalize_category(category)
    if norm_cat:
        qs = qs.filter(category__iexact=norm_cat)

    # 3. Filter by location
    if location and location.strip():
        loc_str = location.strip()
        qs = qs.filter(location__icontains=loc_str)

    # 4. Filter by date recency if requested
    if days_back and isinstance(days_back, int) and days_back > 0:
        cutoff = date.today() - timedelta(days=days_back)
        qs = qs.filter(date__gte=cutoff)

    # 5. Text search across name, description, location, and category
    clean_query = (query or "").strip()
    if clean_query:
        # Full phrase match query
        phrase_q = (
            Q(name__icontains=clean_query) |
            Q(description__icontains=clean_query) |
            Q(location__icontains=clean_query) |
            Q(category__icontains=clean_query)
        )

        # Keyword tokens matching
        raw_tokens = [t.strip().lower() for t in clean_query.split() if len(t.strip()) > 1]
        meaningful_tokens = [t for t in raw_tokens if t not in STOP_WORDS]
        token_list = meaningful_tokens if meaningful_tokens else raw_tokens

        keyword_q = Q()
        for tok in token_list:
            keyword_q |= (
                Q(name__icontains=tok) |
                Q(description__icontains=tok) |
                Q(location__icontains=tok)
            )

        combined_q = phrase_q | keyword_q
        qs = qs.filter(combined_q)

    # Order by most recent date and created_at
    safe_limit = max(1, min(limit, 10))
    matched_items = list(qs.order_by("-date", "-created_at")[:safe_limit])

    # Privacy Guarantee: Only expose safe fields.
    # NEVER expose reporter phone number, email, or user IDs to Gemini or the chatbot.
    results = []
    for itm in matched_items:
        results.append({
            "id": itm.id,
            "name": itm.name,
            "type": itm.item_type,
            "item_type": itm.item_type,
            "category": itm.category,
            "location": itm.location,
            "date": itm.date.strftime("%Y-%m-%d") if itm.date else "",
            "description": (itm.description or "").strip(),
            # Safe placeholder contact status
            "contact_available": bool(itm.contact and itm.contact.strip()),
            "image_url": itm.image_url,
        })

    return {
        "count": len(results),
        "items": results,
        "query_used": {
            "query": clean_query,
            "item_type": item_type,
            "category": norm_cat,
            "location": location,
        }
    }


def verify_item_exists(item_id: int) -> dict:
    """Check if an item exists and retrieve its safe claiming guidance."""
    try:
        itm = Item.objects.get(id=item_id)
        return {
            "exists": True,
            "id": itm.id,
            "name": itm.name,
            "item_type": itm.item_type,
            "category": itm.category,
            "location": itm.location,
            "can_claim": itm.item_type == "found",
        }
    except Item.DoesNotExist:
        return {"exists": False, "id": item_id, "can_claim": False}

