"""
CampusFind - Centralized Category Image Mapping System

Provides consistent, category-based fallback images for all reported campus items.
Priority:
1. User-uploaded photograph (item.image / item.photo / item.image_url) takes top priority.
2. Category matching curated fallback image.
3. 'Others' fallback image.
"""

CATEGORY_IMAGE_MAP = {
    "electronics": "/static/myapp/images/categories/electronics.jpg",
    "bags & wallets": "/static/myapp/images/categories/bags-wallets.jpg",
    "bags": "/static/myapp/images/categories/bags-wallets.jpg",
    "wallets": "/static/myapp/images/categories/bags-wallets.jpg",
    "books & notes": "/static/myapp/images/categories/books-notes.jpg",
    "books & stationery": "/static/myapp/images/categories/books-notes.jpg",
    "books/notes": "/static/myapp/images/categories/books-notes.jpg",
    "clothing": "/static/myapp/images/categories/clothing.jpg",
    "accessories": "/static/myapp/images/categories/accessories.jpg",
    "personal accessories": "/static/myapp/images/categories/accessories.jpg",
    "keys": "/static/myapp/images/categories/keys.jpg",
    "id cards": "/static/myapp/images/categories/id-cards.jpg",
    "id card": "/static/myapp/images/categories/id-cards.jpg",
    "others": "/static/myapp/images/categories/others.jpg",
    "other": "/static/myapp/images/categories/others.jpg",
}

DEFAULT_ITEM_IMAGE = "/static/myapp/images/categories/others.jpg"

BAG_KEYWORDS = [
    "backpack", "bag", "wallet", "purse", "pouch", "handbag",
    "duffel", "duffle", "tote", "briefcase", "satchel", "clutch", "cardholder"
]

ACCESSORY_KEYWORDS = [
    "bottle", "water bottle", "flask", "watch", "smartwatch",
    "sunglasses", "glasses", "spectacles", "key", "keychain", "ring",
    "umbrella", "cap", "hat", "belt", "gloves", "scarf", "jewelry",
    "bracelet", "necklace", "earring", "claw clip", "scrunchie", "charger"
]


def is_bag_or_wallet(item) -> bool:
    """Return True if the item is specifically a bag, backpack, wallet, or purse."""
    cat = ""
    name = ""
    if hasattr(item, 'category'):
        cat = str(item.category or "").strip().lower()
    elif isinstance(item, dict):
        cat = str(item.get('category') or "").strip().lower()

    if hasattr(item, 'name'):
        name = str(item.name or "").strip().lower()
    elif isinstance(item, dict):
        name = str(item.get('name') or "").strip().lower()

    if "bag" in cat or "wallet" in cat:
        return True
    return any(w in name for w in BAG_KEYWORDS)


def is_accessory(item) -> bool:
    """Return True if the item is a personal accessory and NOT a bag/wallet."""
    if is_bag_or_wallet(item):
        return False

    cat = ""
    name = ""
    if hasattr(item, 'category'):
        cat = str(item.category or "").strip().lower()
    elif isinstance(item, dict):
        cat = str(item.get('category') or "").strip().lower()

    if hasattr(item, 'name'):
        name = str(item.name or "").strip().lower()
    elif isinstance(item, dict):
        name = str(item.get('name') or "").strip().lower()

    if "accessori" in cat or "key" in cat:
        return True
    return any(w in name for w in ACCESSORY_KEYWORDS)


def resolve_canonical_category(item) -> str:
    """Resolve display category, separating bags & wallets from accessories."""
    if is_bag_or_wallet(item):
        return "Bags & Wallets"
    if is_accessory(item):
        return "Accessories"

    cat = ""
    name = ""
    if hasattr(item, 'category'):
        cat = str(item.category or "").strip().lower()
    elif isinstance(item, dict):
        cat = str(item.get('category') or "").strip().lower()

    if hasattr(item, 'name'):
        name = str(item.name or "").strip().lower()
    elif isinstance(item, dict):
        name = str(item.get('name') or "").strip().lower()

    if "electronic" in cat or any(w in name for w in ["phone", "laptop", "macbook", "headphone", "earbud", "tablet"]):
        return "Electronics"
    if "card" in cat or any(w in name for w in ["id card", "badge", "student id", "lanyard"]):
        return "ID Cards"
    if "book" in cat or "note" in cat or "stationery" in cat or any(w in name for w in ["book", "notebook", "textbook", "notes"]):
        return "Books & Notes"
    if "cloth" in cat or any(w in name for w in ["jacket", "shirt", "hoodie", "sweater"]):
        return "Clothing"

    # Return original category title if available
    orig = getattr(item, 'category', None) or (item.get('category') if isinstance(item, dict) else "")
    return orig or "Accessories"


def get_item_image_url(item) -> str:
    """
    Return the primary photograph or category fallback image for an item.

    Priority:
    1. If an item has its own uploaded photograph (item.image / item.photo / item.image_url), use that.
    2. If an item has no photograph, use the matching category fallback image.
    3. If category is missing or unknown, use the 'Others' fallback image.
    """
    if not item:
        return DEFAULT_ITEM_IMAGE

    # 1. User-uploaded photograph takes absolute priority
    if hasattr(item, 'image') and item.image:
        try:
            return item.image.url
        except Exception:
            pass
    if hasattr(item, 'photo') and item.photo:
        try:
            return item.photo.url
        except Exception:
            pass
    if isinstance(item, dict):
        img_url = item.get('image_url') or item.get('image') or item.get('photo')
        if img_url and str(img_url).strip() and not str(img_url).strip().startswith('/static/myapp/images/categories/'):
            return str(img_url).strip()

    # 2. Specific Bag vs Accessory distinction
    if is_bag_or_wallet(item):
        return CATEGORY_IMAGE_MAP["bags & wallets"]
    if is_accessory(item):
        return CATEGORY_IMAGE_MAP["accessories"]

    cat = ""
    name = ""
    if hasattr(item, 'category'):
        cat = str(item.category or "").strip().lower()
    elif isinstance(item, dict):
        cat = str(item.get('category') or "").strip().lower()

    if hasattr(item, 'name'):
        name = str(item.name or "").strip().lower()
    elif isinstance(item, dict):
        name = str(item.get('name') or "").strip().lower()

    # Exact category match
    if cat in CATEGORY_IMAGE_MAP:
        return CATEGORY_IMAGE_MAP[cat]

    # Keyword / category inference
    if "electronic" in cat or any(w in name for w in ["phone", "laptop", "macbook", "headphone", "earbud", "airpod", "charger", "smartwatch", "tablet", "ipad"]):
        return CATEGORY_IMAGE_MAP["electronics"]
    if "book" in cat or "note" in cat or "stationery" in cat or any(w in name for w in ["book", "notebook", "textbook", "diary", "notes", "pencil", "pen"]):
        return CATEGORY_IMAGE_MAP["books & notes"]
    if "cloth" in cat or any(w in name for w in ["jacket", "shirt", "hoodie", "sweater", "scarf", "cap"]):
        return CATEGORY_IMAGE_MAP["clothing"]
    if "card" in cat or any(w in name for w in ["id card", "badge", "student id", "lanyard"]):
        return CATEGORY_IMAGE_MAP["id cards"]

    # 3. Default Others fallback
    return DEFAULT_ITEM_IMAGE
