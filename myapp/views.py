
import json
import os
from datetime import date, datetime, timedelta
from google import genai
from google.genai import types
from django.views.decorators.csrf import ensure_csrf_cookie

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required, user_passes_test
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_protect
from django.db.models import Q, Count
from django.utils import timezone
from django.views.decorators.cache import never_cache

from .models import Item, ClaimRequest, Notification
from .item_search import search_campus_items, verify_item_exists
from .category_images import get_item_image_url


# ---------------- HOME PAGE ----------------

@login_required(login_url='login')
@never_cache
@ensure_csrf_cookie
def home(request):
    """Main CampusFind community board page."""
    approved_claims = ClaimRequest.objects.filter(status='approved').count()
    total_items = Item.objects.count()
    active_users = User.objects.count()

    reunited_display = f"{approved_claims}+" if approved_claims > 0 else "320+"
    students_display = f"{active_users}+" if active_users > 0 else "500+"

    if total_items > 0 and approved_claims > 0:
        rate_val = min(99, max(80, int((approved_claims / total_items) * 100)))
        rate_display = f"{rate_val}%"
    else:
        rate_display = "95%"

    db_locations = list(Item.objects.values_list('location', flat=True).distinct()[:20])
    locations = sorted(list(set([loc.strip() for loc in db_locations if loc and loc.strip()])))

    return render(request, 'myapp/index.html', {
        'user': request.user,
        'reunited_display': reunited_display,
        'students_display': students_display,
        'rate_display': rate_display,
        'locations': locations,
    })


# ---------------- LOGIN AND REGISTRATION ----------------

def login_view(request):
    """Unified login and registration view."""

    next_url = (
        request.GET.get('next')
        or request.POST.get('next')
        or 'home'
    )

    if request.method == 'POST':
        action = request.POST.get('action', 'login')

        if action == 'register':
            username = request.POST.get('reg_username', '').strip()
            email = request.POST.get('reg_email', '').strip()
            password = request.POST.get('reg_password', '')
            confirm_password = request.POST.get(
                'reg_confirm_password', ''
            )

            if not username or not password:
                messages.error(
                    request,
                    'Please provide both username and password.'
                )
                return render(request, 'myapp/login.html', {
                    'active_tab': 'register',
                    'next': next_url,
                    'reg_username': username,
                    'reg_email': email,
                })

            if len(password) < 6:
                messages.error(
                    request,
                    'Password must be at least 6 characters long.'
                )
                return render(request, 'myapp/login.html', {
                    'active_tab': 'register',
                    'next': next_url,
                    'reg_username': username,
                    'reg_email': email,
                })

            if password != confirm_password:
                messages.error(
                    request,
                    'Passwords do not match. Please try again.'
                )
                return render(request, 'myapp/login.html', {
                    'active_tab': 'register',
                    'next': next_url,
                    'reg_username': username,
                    'reg_email': email,
                })

            if User.objects.filter(
                username__iexact=username
            ).exists():
                messages.error(
                    request,
                    f'Username "{username}" is already taken.'
                )
                return render(request, 'myapp/login.html', {
                    'active_tab': 'register',
                    'next': next_url,
                    'reg_email': email,
                })

            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
            )
            login(request, user)
            messages.success(
                request,
                f'Welcome to CampusFind, {user.username}!'
            )
            return redirect(next_url)

        # Standard login
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        remember_me = request.POST.get('remember_me')

        if not username or not password:
            messages.error(
                request,
                'Please enter your username and password.'
            )
            return render(request, 'myapp/login.html', {
                'active_tab': 'login',
                'next': next_url,
                'username': username,
            })

        user = authenticate(
            request,
            username=username,
            password=password,
        )

        if user is not None:
            login(request, user)

            if not remember_me:
                request.session.set_expiry(0)

            messages.success(
                request,
                f'Welcome back, {user.username}!'
            )
            return redirect(next_url)

        messages.error(
            request,
            'Invalid username or password.'
        )
        return render(request, 'myapp/login.html', {
            'active_tab': 'login',
            'next': next_url,
            'username': username,
        })

    active_tab = request.GET.get('tab', 'login')
    return render(request, 'myapp/login.html', {
        'active_tab': active_tab,
        'next': next_url,
    })


def register_view(request):
    """Convenience view for registration."""

    if request.method == 'POST':
        return login_view(request)

    return render(request, 'myapp/login.html', {
        'active_tab': 'register',
        'next': request.GET.get('next', 'home'),
    })


def logout_view(request):
    """Log out and return to the login page."""

    logout(request)
    messages.info(
        request,
        'You have been successfully signed out.'
    )
    return redirect('login')


# ---------------- ITEM API ----------------

def serialize_item(item, current_user=None):
    """Convert a database item into JSON-safe data with role-aware contact visibility."""
    is_owner = False
    is_staff = False
    is_authenticated = False

    if current_user and current_user.is_authenticated:
        is_authenticated = True
        is_owner = (item.user_id == current_user.id)
        is_staff = getattr(current_user, 'is_staff', False) or getattr(current_user, 'is_superuser', False)

    raw_contact = (item.contact or "").strip()
    is_protected_pref = raw_contact.startswith("PROTECTED:")
    actual_contact = raw_contact.replace("PROTECTED:", "", 1).strip() if is_protected_pref else raw_contact

    # Contact Privacy Policy:
    # 1. Unauthenticated users: always masked
    # 2. If reporter chose protected: only owner and staff see raw contact, others see safe message
    # 3. Otherwise: verified logged-in students see contact details
    if not is_authenticated:
        contact_display = "Contact protected – submit a claim request below."
        is_contact_protected = True
    elif is_protected_pref and not (is_owner or is_staff):
        contact_display = "Contact protected – submit a claim request below."
        is_contact_protected = True
    else:
        contact_display = actual_contact
        is_contact_protected = False

    from .category_images import resolve_canonical_category
    canonical_category = resolve_canonical_category(item)

    return {
        'id': item.id,
        'name': item.name,
        'item_type': item.item_type,
        'category': canonical_category,
        'location': item.location,
        'date': item.date.isoformat(),
        'contact': contact_display,
        'is_contact_protected': is_contact_protected,
        'description': item.description,
        'created_at': item.created_at.isoformat(),
        'reporter_username': item.user.username if item.user else 'Campus Member',
        'is_owner': is_owner,
        'image_url': getattr(item, 'image_url', get_item_image_url(item)),
    }


# ---------------- NOTIFICATION SYSTEM HELPERS ----------------

def create_notification(recipient, title, message, notification_type="system", related_item=None, related_claim=None, target_url=""):
    """Safely create a notification for a user."""
    if not recipient:
        return None
    try:
        return Notification.objects.create(
            recipient=recipient,
            title=title,
            message=message,
            notification_type=notification_type,
            related_item=related_item,
            related_claim=related_claim,
            target_url=target_url or "",
        )
    except Exception:
        return None


def notify_admins(title, message, notification_type="system", related_item=None, related_claim=None, target_url=""):
    """Notify all staff and superuser administrators."""
    try:
        admins = User.objects.filter(Q(is_staff=True) | Q(is_superuser=True), is_active=True).distinct()
        created = []
        for admin in admins:
            n = create_notification(
                recipient=admin,
                title=title,
                message=message,
                notification_type=notification_type,
                related_item=related_item,
                related_claim=related_claim,
                target_url=target_url,
            )
            if n:
                created.append(n)
        return created
    except Exception:
        return []


def serialize_notification(n):
    """Serialize notification model to JSON payload."""
    return {
        "id": n.id,
        "title": n.title,
        "message": n.message,
        "type": n.notification_type,
        "target_url": n.target_url,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat(),
        "created_at_formatted": n.created_at.strftime("%b %d, %I:%M %p"),
        "item_id": n.related_item_id,
        "claim_id": n.related_claim_id,
    }


@login_required(login_url='login')
@require_http_methods(['GET', 'POST'])
@csrf_protect
def items_api(request):
    """Retrieve items from PostgreSQL or save a new report."""

    if request.method == 'GET':
        items = Item.objects.all().select_related('user').order_by('-created_at')

        item_type = request.GET.get('type', '').strip()
        category = request.GET.get('category', '').strip()
        search = request.GET.get('search', '').strip()

        if item_type in ('lost', 'found'):
            items = items.filter(item_type=item_type)

        if category:
            items = items.filter(category=category)

        if search:
            items = items.filter(
                Q(name__icontains=search)
                | Q(location__icontains=search)
            )

        return JsonResponse({
            'current_user_id': request.user.id,
            'items': [
                serialize_item(item, request.user)
                for item in items
            ]
        })

    try:
        # Support both multipart/form-data (with file upload) and application/json
        if request.content_type.startswith('multipart/form-data') or request.FILES:
            data = request.POST
            image_file = request.FILES.get('image') or request.FILES.get('photo')
        else:
            try:
                data = json.loads(request.body or '{}')
            except Exception:
                data = request.POST
            image_file = request.FILES.get('image') or request.FILES.get('photo')

        name = data.get('name', '').strip()
        item_type = data.get('item_type', '')
        category = data.get('category', '')
        location = data.get('location', '').strip()
        contact = data.get('contact', '').strip()
        description = data.get('description', '').strip()
        raw_date = data.get('date', '')

        # Image validation if uploaded
        if image_file:
            # 1. Size check: 5 MB limit
            max_size = 5 * 1024 * 1024
            if image_file.size > max_size:
                return JsonResponse({
                    'error': 'Image file is too large. Maximum allowed size is 5 MB.'
                }, status=400)

            # 2. Extension check
            ext = os.path.splitext(image_file.name)[1].lower()
            allowed_extensions = {'.jpg', '.jpeg', '.png', '.webp'}
            if ext not in allowed_extensions:
                return JsonResponse({
                    'error': 'Invalid image format. Allowed formats are JPG, JPEG, PNG, and WEBP.'
                }, status=400)

            # 3. Content integrity validation using Pillow
            from PIL import Image
            try:
                img = Image.open(image_file)
                img.verify()
                image_file.seek(0)
            except Exception:
                return JsonResponse({
                    'error': 'The uploaded file is not a valid or readable image.'
                }, status=400)

        valid_categories = {
            'Electronics',
            'ID Cards',
            'Books & Notes',
            'Books/Notes',
            'Keys',
            'Accessories',
            'Personal Accessories',
            'Bags & Wallets',
            'Bags/Wallets',
            'Bags',
            'Clothing',
            'Others',
            'Other',
        }

        if category == 'Personal Accessories':
            category = 'Accessories'
        elif category == 'Books/Notes':
            category = 'Books & Notes'
        elif category in ('Bags/Wallets', 'Bags'):
            category = 'Bags & Wallets'
        elif category == 'Other':
            category = 'Others'

        if not all([name, location, contact, raw_date]):
            return JsonResponse({
                'error': 'Name, location, date, and contact are required.'
            }, status=400)

        if item_type not in ('lost', 'found'):
            return JsonResponse({
                'error': 'Choose Lost or Found.'
            }, status=400)

        if category not in valid_categories:
            return JsonResponse({
                'error': 'Choose a valid category.'
            }, status=400)

        try:
            item_date = date.fromisoformat(raw_date)
        except (ValueError, TypeError):
            return JsonResponse({
                'error': 'Enter a valid date in YYYY-MM-DD format.'
            }, status=400)

        raw_share = data.get('share_contact', True)
        share_contact = raw_share in (True, 'true', '1', 'on', 'True') if raw_share is not None else True
        if not share_contact and not contact.startswith("PROTECTED:"):
            contact = f"PROTECTED:{contact}"

        item = Item.objects.create(
            user=request.user,
            name=name,
            item_type=item_type,
            category=category,
            location=location,
            date=item_date,
            contact=contact,
            description=description,
            image=image_file,
        )

        # Notify administrators of newly reported item
        type_badge = "FOUND" if item_type == "found" else "LOST"
        reporter_name = request.user.username if request.user.is_authenticated else "A student"
        notify_admins(
            title="New item reported",
            message=f"'{name}' has been reported as {type_badge} in {category} by {reporter_name}.",
            notification_type="new_item",
            related_item=item,
            target_url="/admin-dashboard/items/",
        )

        return JsonResponse({
            'message': 'Item reported successfully!',
            'item': serialize_item(item, request.user),
        }, status=201)

    except (json.JSONDecodeError, AttributeError, TypeError):
        return JsonResponse({
            'error': 'Invalid report data.'
        }, status=400)


# ---------------- ITEM DELETION API ----------------

@login_required(login_url='login')
@require_http_methods(['POST', 'DELETE'])
@csrf_protect
def delete_item_api(request, item_id):
    """Delete an item reported by the logged in user."""
    try:
        item = Item.objects.get(pk=item_id)
    except Item.DoesNotExist:
        return JsonResponse({'error': 'Item not found.'}, status=404)

    # Permission check: Only the reporter who created the item can delete it
    if item.user_id != request.user.id:
        return JsonResponse({
            'error': 'Permission denied. You can only delete items that you reported.'
        }, status=403)

    item_name = item.name
    item.delete()

    return JsonResponse({
        'message': f'"{item_name}" has been deleted successfully.',
        'deleted_id': item_id,
    })


@login_required(login_url='login')
@require_POST
@csrf_protect
def delete_item_view(request, item_id):
    """Direct form action for deleting an item from the profile page."""
    try:
        item = Item.objects.get(pk=item_id)
    except Item.DoesNotExist:
        messages.error(request, 'Item not found.')
        return redirect('profile')

    if item.user_id != request.user.id:
        messages.error(request, 'Permission denied. Only the reporter can delete this item.')
        return redirect('profile')

    item_name = item.name
    item.delete()
    messages.success(request, f'Report for "{item_name}" has been deleted.')
    return redirect('profile')


# ---------------- USER PROFILE & ACCOUNT MANAGEMENT ----------------

@login_required(login_url='login')
@never_cache
def profile_view(request):
    """User profile overview, report history, and account options."""
    user = request.user
    user_items = Item.objects.filter(user=user).order_by('-created_at')

    total_reported = user_items.count()
    lost_count = user_items.filter(item_type='lost').count()
    found_count = user_items.filter(item_type='found').count()

    return render(request, 'myapp/profile.html', {
        'user': user,
        'items': user_items,
        'total_reported': total_reported,
        'lost_count': lost_count,
        'found_count': found_count,
    })


@login_required(login_url='login')
@require_POST
@csrf_protect
def edit_profile_view(request):
    """Update profile username, email, and password."""
    user = request.user
    username = request.POST.get('username', '').strip()
    email = request.POST.get('email', '').strip()
    current_password = request.POST.get('current_password', '')
    new_password = request.POST.get('new_password', '')
    confirm_password = request.POST.get('confirm_password', '')

    if not username:
        messages.error(request, 'Username cannot be empty.')
        return redirect('profile')

    # If username is changing, ensure uniqueness
    if username.lower() != user.username.lower():
        if User.objects.filter(username__iexact=username).exists():
            messages.error(request, f'Username "{username}" is already taken.')
            return redirect('profile')

    # Password update check if provided
    if new_password:
        if not current_password or not user.check_password(current_password):
            messages.error(request, 'Current password was incorrect. Password was not changed.')
            return redirect('profile')
        if len(new_password) < 6:
            messages.error(request, 'New password must be at least 6 characters.')
            return redirect('profile')
        if new_password != confirm_password:
            messages.error(request, 'New passwords do not match.')
            return redirect('profile')

        user.set_password(new_password)
        from django.contrib.auth import update_session_auth_hash
        update_session_auth_hash(request, user)

    user.username = username
    user.email = email
    user.save()

    messages.success(request, 'Profile details updated successfully!')
    return redirect('profile')


@login_required(login_url='login')
@require_POST
@csrf_protect
def delete_account_view(request):
    """Permanently delete user account and its data."""
    user = request.user
    confirm_username = request.POST.get('confirm_username', '').strip()
    password = request.POST.get('password', '')

    if confirm_username != user.username:
        messages.error(request, f'Type your exact username "{user.username}" to confirm deletion.')
        return redirect('profile')

    if not password or not user.check_password(password):
        messages.error(request, 'Incorrect password. Account deletion aborted.')
        return redirect('profile')

    username = user.username
    logout(request)
    user.delete()

    messages.info(request, f'Account "{username}" has been permanently deleted.')
    return redirect('login')


# ---------------- CLAIM REQUEST API ----------------

@login_required(login_url='login')
@require_POST
@csrf_protect
def claims_api(request):
    """Save a claim request for a found item."""

    try:
        data = json.loads(request.body or '{}')

        item_id = data.get('item_id')
        claimant_name = data.get(
            'claimant_name', ''
        ).strip()
        claimant_contact = data.get(
            'claimant_contact', ''
        ).strip()
        message = data.get('message', '').strip()

        if not all([
            item_id,
            claimant_name,
            claimant_contact,
            message,
        ]):
            return JsonResponse({
                'error': 'Complete all claim fields.'
            }, status=400)

        try:
            item = Item.objects.get(pk=item_id)
        except (Item.DoesNotExist, ValueError, TypeError):
            return JsonResponse({
                'error': 'Item not found.'
            }, status=404)

        claim = ClaimRequest.objects.create(
            item=item,
            claimant_name=claimant_name,
            claimant_contact=claimant_contact,
            message=message,
        )

        # 1. Notify administrators of incoming claim request
        notify_admins(
            title="New claim request",
            message=f"{claimant_name} submitted a claim verification request for '{item.name}'.",
            notification_type="new_claim",
            related_item=item,
            related_claim=claim,
            target_url="/admin-dashboard/claims/",
        )

        # 2. Notify item reporter (if item was reported by an authenticated user other than claimant)
        if item.user and (not request.user.is_authenticated or request.user != item.user):
            create_notification(
                recipient=item.user,
                title="Claim submitted for your item",
                message=f"A student has submitted a claim verification request for your reported item '{item.name}'.",
                notification_type="new_claim",
                related_item=item,
                related_claim=claim,
                target_url="#community-board",
            )

        return JsonResponse({
            'message': 'Claim request submitted successfully!',
            'claim_id': claim.id,
        }, status=201)

    except (json.JSONDecodeError, AttributeError, TypeError):
        return JsonResponse({
            'error': 'Invalid claim data.'
        }, status=400)


# ---------------- NOTIFICATION SYSTEM APIS ----------------

@require_http_methods(['GET'])
def notifications_api(request):
    """Retrieve notifications belonging to the logged-in user."""
    if not request.user.is_authenticated:
        return JsonResponse({
            "error": "Authentication required.",
            "unread_count": 0,
            "notifications": []
        }, status=401)

    try:
        notifs = list(Notification.objects.filter(recipient=request.user).order_by('-created_at')[:40])
        unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return JsonResponse({
            "unread_count": unread_count,
            "notifications": [serialize_notification(n) for n in notifs]
        }, status=200)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Notifications API error: %s", e)
        return JsonResponse({
            "error": "Unable to load notifications. Please try again.",
            "unread_count": 0,
            "notifications": []
        }, status=500)


@require_POST
@csrf_protect
def mark_notification_read_api(request, notification_id):
    """Mark a single notification as read for the current user."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)

    try:
        notif = get_object_or_404(Notification, id=notification_id, recipient=request.user)
        if not notif.is_read:
            notif.is_read = True
            notif.save(update_fields=['is_read'])
        unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return JsonResponse({
            "success": True,
            "unread_count": unread_count
        })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_POST
@csrf_protect
def mark_all_notifications_read_api(request):
    """Mark all unread notifications for current user as read."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required."}, status=401)

    try:
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return JsonResponse({
            "success": True,
            "unread_count": 0
        })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(['GET'])
def unread_notifications_count_api(request):
    """Return unread count for bell badge polling."""
    if not request.user.is_authenticated:
        return JsonResponse({"unread_count": 0}, status=200)

    try:
        unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return JsonResponse({
            "unread_count": unread_count
        }, status=200)
    except Exception:
        return JsonResponse({
            "unread_count": 0
        }, status=200)


# ---------------- GEMINI AI CHATBOT ----------------

# ---------------- GEMINI AI CHATBOT WITH DATABASE CONNECTION ----------------

@login_required(login_url='login')
@require_POST
@csrf_protect
def chatbot_api(request):
    """
    CampusFind AI Chatbot endpoint connected to PostgreSQL database.
    Integrates Gemini tool function calling with Django ORM for verified record retrieval.
    """
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key or api_key.strip() == "paste_your_google_ai_studio_key_here":
            return JsonResponse({
                "error": "Gemini API key is not configured. Please add your GEMINI_API_KEY to the .env file."
            }, status=500)

        data = json.loads(request.body or "{}")
        message = data.get("message", "").strip()
        history_data = data.get("history", [])

        if not message:
            return JsonResponse({
                "error": "Please enter a message."
            }, status=400)

        if len(message) > 2000:
            return JsonResponse({
                "error": "Message is too long."
            }, status=400)

        # Normalize and filter last 10 conversation messages
        history = []
        for item in history_data[-10:]:
            role = item.get("role")
            content = item.get("content", "")
            if role in ("user", "model") and content:
                history.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=content)]
                    )
                )

        client = genai.Client(api_key=api_key)
        preferred_model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
        candidate_models = [
            preferred_model,
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-3.8-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
        ]
        models_to_try = []
        for m in candidate_models:
            if m and m not in models_to_try:
                models_to_try.append(m)

        # Container to collect database items retrieved during tool calls
        retrieved_items = []

        # Tool 1: Safe database search
        def search_database_items(query: str = "", item_type: str = "all", category: str = "", location: str = "") -> dict:
            """Search the official Campus Lost & Found PostgreSQL database for reported items.

            Args:
                query: keywords or item name to search (e.g., 'black water bottle', 'student ID', 'keys', 'blue backpack')
                item_type: 'found' when searching for items that someone turned in/found, 'lost' when searching for items reported missing by owners, or 'all'
                category: optional category ('Electronics', 'ID Cards', 'Books & Notes', 'Keys', 'Accessories')
                location: optional campus location (e.g., 'Library', 'Cafeteria', 'Engineering Block', 'Gym')
            """
            search_res = search_campus_items(
                query=query,
                item_type=item_type,
                category=category,
                location=location
            )
            for itm in search_res.get("items", []):
                if not any(existing["id"] == itm["id"] for existing in retrieved_items):
                    card_itm = dict(itm)
                    try:
                        db_item = Item.objects.get(id=itm["id"])
                        serialized = serialize_item(db_item, request.user)
                        card_itm["contact"] = serialized["contact"]
                        card_itm["is_contact_protected"] = serialized["is_contact_protected"]
                        card_itm["is_owner"] = serialized["is_owner"]
                        card_itm["image_url"] = serialized["image_url"]
                    except Item.DoesNotExist:
                        pass
                    retrieved_items.append(card_itm)
            return search_res

        # Tool 2: Check item claim eligibility
        def check_item_claim_eligibility(item_id: int) -> dict:
            """Check if a specific item exists in the database and verify if it can be claimed.

            Args:
                item_id: The integer ID of the item
            """
            info = verify_item_exists(item_id)
            return info

        # Tool 3: Get item details
        def get_item_details(item_id: int) -> dict:
            """Get full details and verification status of a specific item from the database.

            Args:
                item_id: The integer ID of the item
            """
            return verify_item_exists(item_id)

        system_instruction = (
            "You are CampusFind AI, the official intelligent Lost & Found assistant for the campus community.\n"
            "Your job is to search the actual campus database and provide accurate, helpful answers based strictly on real records.\n\n"
            "OPERATING GUIDELINES:\n"
            "1. ALWAYS invoke `search_database_items` whenever the student mentions an item, asks if something was found/lost, or searches the catalog.\n"
            "2. NEVER invent, fabricate, or assume an item exists without retrieving it from the database. Only discuss items returned by `search_database_items`.\n"
            "3. If a student says they LOST an item, search with `item_type='all'` or `item_type='found'` to check for found matches.\n"
            "4. If a student says they FOUND an item, search with `item_type='all'` or `item_type='lost'` to see if the owner reported it missing.\n"
            "5. If matching records are found:\n"
            "   - State the item name, status (LOST or FOUND), category, location, and reported date.\n"
            "   - If it is a FOUND item, guide the student that they can click '✨ View & Claim' on the item card below to submit their ownership verification request.\n"
            "   - If it is a LOST item, mention that someone reported it missing.\n"
            "6. If no matching items are found in the database, respond politely:\n"
            "   'I couldn't find an exact match in our current reports. Would you like to check the Community Board or submit a new report?'\n"
            "7. PRIVACY & SECURITY: Never ask for or expose private student contact information (phone numbers, private emails) or claimant details directly in the chat. Direct them to the official claim form or report form.\n"
            "8. Be friendly, concise, and helpful."
        )

        last_error = None
        reply_text = None

        for model_name in models_to_try:
            try:
                chat = client.chats.create(
                    model=model_name,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        tools=[search_database_items, check_item_claim_eligibility, get_item_details],
                        temperature=0.2,
                    ),
                    history=history,
                )
                response = chat.send_message(message)
                if response and response.text:
                    reply_text = response.text
                    break
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Chatbot model %s attempt failed: %s", model_name, e)
                last_error = e
                continue

        # If Gemini is unreachable or rate limited across all models, fall back to direct DB search
        if not reply_text:
            import logging
            logging.getLogger(__name__).error("Gemini chatbot fallback triggered. Last error: %s", last_error)
            fallback_res = search_campus_items(query=message, item_type="all")
            for itm in fallback_res.get("items", []):
                if not any(existing["id"] == itm["id"] for existing in retrieved_items):
                    card_itm = dict(itm)
                    try:
                        db_item = Item.objects.get(id=itm["id"])
                        serialized = serialize_item(db_item, request.user)
                        card_itm["contact"] = serialized["contact"]
                        card_itm["is_contact_protected"] = serialized["is_contact_protected"]
                        card_itm["is_owner"] = serialized["is_owner"]
                        card_itm["image_url"] = serialized["image_url"]
                    except Item.DoesNotExist:
                        pass
                    retrieved_items.append(card_itm)

            if retrieved_items:
                reply_text = (
                    "I searched the campus records directly and found matching items:"
                )
            else:
                reply_text = (
                    "I searched our campus database, but couldn't find an exact match for your request. "
                    "You can browse all recent posts on the Community Board or submit a new report if you lost or found an item."
                )

        # Safety Fallback Intent: If no tool was invoked during LLM chat but user asked for an item, do a search to ensure cards appear
        if not retrieved_items:
            lower_msg = message.lower()
            item_keywords = [
                "lost", "found", "looking for", "missing", "anyone seen", "has anyone found",
                "bottle", "bag", "backpack", "keys", "phone", "card", "id", "laptop", "wallet",
                "watch", "headphones", "earbuds", "charger", "umbrella", "notes", "book", "cap", "clothing"
            ]
            if any(k in lower_msg for k in item_keywords):
                fallback_res = search_campus_items(query=message, item_type="all")
                for itm in fallback_res.get("items", []):
                    if not any(existing["id"] == itm["id"] for existing in retrieved_items):
                        card_itm = dict(itm)
                        try:
                            db_item = Item.objects.get(id=itm["id"])
                            serialized = serialize_item(db_item, request.user)
                            card_itm["contact"] = serialized["contact"]
                            card_itm["is_contact_protected"] = serialized["is_contact_protected"]
                            card_itm["is_owner"] = serialized["is_owner"]
                            card_itm["image_url"] = serialized["image_url"]
                        except Item.DoesNotExist:
                            pass
                        retrieved_items.append(card_itm)

        return JsonResponse({
            "reply": reply_text,
            "items": retrieved_items
        })

    except json.JSONDecodeError:
        return JsonResponse({
            "error": "Invalid request payload."
        }, status=400)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Chatbot unexpected error: %s", e, exc_info=True)
        return JsonResponse({
            "reply": "I'm having trouble connecting right now. Please try searching on the Community Board or ask again in a moment.",
            "items": []
        }, status=200)


# ---------------- CUSTOM ADMIN DASHBOARD & MANAGEMENT ----------------

def is_staff_or_admin(user):
    return user.is_authenticated and (user.is_staff or user.is_superuser)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_dashboard(request):
    """Display the CampusFind custom admin dashboard."""
    total_items = Item.objects.count()
    lost_items = Item.objects.filter(item_type='lost').count()
    found_items = Item.objects.filter(item_type='found').count()

    total_users = User.objects.count()

    total_claims = ClaimRequest.objects.count()
    pending_claims = ClaimRequest.objects.filter(status='pending').count()
    approved_claims = ClaimRequest.objects.filter(status='approved').count()
    rejected_claims = ClaimRequest.objects.filter(status='rejected').count()

    recent_items = (
        Item.objects.select_related('user')
        .order_by('-created_at')[:6]
    )

    recent_claims = (
        ClaimRequest.objects.select_related('item')
        .order_by('-created_at')[:6]
    )

    # Category breakdown for charts
    cat_qs = Item.objects.values('category').annotate(count=Count('id')).order_by('-count')
    category_labels = [c['category'] for c in cat_qs]
    category_counts = [c['count'] for c in cat_qs]

    if not category_labels:
        category_labels = ["Electronics", "ID Cards", "Books & Notes", "Keys", "Accessories"]
        category_counts = [0, 0, 0, 0, 0]

    # Monthly trends (last 6 months)
    now = timezone.now()
    month_labels = []
    month_counts = []
    for i in range(5, -1, -1):
        target_year = now.year
        target_month = now.month - i
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        m_name = datetime(target_year, target_month, 1).strftime('%b')
        month_labels.append(m_name)
        cnt = Item.objects.filter(created_at__year=target_year, created_at__month=target_month).count()
        month_counts.append(cnt)

    chart_data = {
        'lost_items': lost_items,
        'found_items': found_items,
        'category_labels': category_labels,
        'category_counts': category_counts,
        'month_labels': month_labels,
        'month_counts': month_counts,
        'pending_claims': pending_claims,
        'approved_claims': approved_claims,
        'rejected_claims': rejected_claims,
    }

    context = {
        'active_page': 'dashboard',
        'total_items': total_items,
        'lost_items': lost_items,
        'found_items': found_items,
        'total_users': total_users,
        'total_claims': total_claims,
        'pending_claims': pending_claims,
        'approved_claims': approved_claims,
        'rejected_claims': rejected_claims,
        'pending_claims_count': pending_claims,
        'recent_items': recent_items,
        'recent_claims': recent_claims,
        'chart_data': chart_data,
    }

    return render(request, 'myapp/admin/dashboard.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_items(request):
    """Manage and filter all reported campus items."""
    q = request.GET.get('q', '').strip()
    category = request.GET.get('category', '').strip()
    item_type = request.GET.get('type', '').strip()

    items = Item.objects.select_related('user').all()

    if q:
        items = items.filter(
            Q(name__icontains=q) |
            Q(location__icontains=q) |
            Q(description__icontains=q) |
            Q(contact__icontains=q)
        )
    if category:
        items = items.filter(category=category)
    if item_type in ['lost', 'found']:
        items = items.filter(item_type=item_type)

    items = items.order_by('-created_at')

    categories = [cat[0] for cat in Item.CATEGORIES]
    pending_claims_count = ClaimRequest.objects.filter(status='pending').count()

    context = {
        'active_page': 'items',
        'items': items,
        'total_count': items.count(),
        'query': q,
        'selected_category': category,
        'selected_type': item_type,
        'categories': categories,
        'pending_claims_count': pending_claims_count,
    }
    return render(request, 'myapp/admin/items.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
@require_POST
@csrf_protect
def admin_edit_item(request, item_id):
    """Edit report details from admin panel."""
    item = get_object_or_404(Item, id=item_id)
    name = request.POST.get('name', '').strip()
    item_type = request.POST.get('item_type', '').strip()
    category = request.POST.get('category', '').strip()
    location = request.POST.get('location', '').strip()
    contact = request.POST.get('contact', '').strip()
    description = request.POST.get('description', '').strip()
    date_val = request.POST.get('date', '').strip()

    if name:
        item.name = name
    if item_type in ['lost', 'found']:
        item.item_type = item_type
    if category:
        item.category = category
    if location:
        item.location = location
    if contact:
        item.contact = contact
    item.description = description
    if date_val:
        try:
            item.date = datetime.strptime(date_val, '%Y-%m-%d').date()
        except ValueError:
            pass

    item.save()
    messages.success(request, f"Item '{item.name}' (ID #{item.id}) updated successfully.")
    return redirect('admin_items')


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
@require_POST
@csrf_protect
def admin_delete_item(request, item_id):
    """Safely delete an item report and related claims."""
    item = get_object_or_404(Item, id=item_id)
    name = item.name
    reporter = item.user
    if reporter and (not request.user.is_authenticated or request.user != reporter):
        create_notification(
            recipient=reporter,
            title="Item report removed",
            message=f"Your report for '{name}' was removed during campus moderation.",
            notification_type="item_removed",
        )
    item.delete()
    messages.success(request, f"Report for '{name}' was removed successfully.")
    return redirect(request.META.get('HTTP_REFERER') or 'admin_items')


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_claims(request):
    """Review and verify student ownership claims."""
    status_filter = request.GET.get('status', '').strip().lower()
    claims = ClaimRequest.objects.select_related('item').all()

    if status_filter in ['pending', 'approved', 'rejected']:
        claims = claims.filter(status=status_filter)

    claims = claims.order_by('-created_at')

    total_claims_count = ClaimRequest.objects.count()
    pending_count = ClaimRequest.objects.filter(status='pending').count()
    approved_count = ClaimRequest.objects.filter(status='approved').count()
    rejected_count = ClaimRequest.objects.filter(status='rejected').count()

    context = {
        'active_page': 'claims',
        'claims': claims,
        'status_filter': status_filter,
        'total_claims_count': total_claims_count,
        'pending_count': pending_count,
        'approved_count': approved_count,
        'rejected_count': rejected_count,
        'pending_claims_count': pending_count,
    }
    return render(request, 'myapp/admin/claims.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
@require_POST
@csrf_protect
def admin_update_claim_status(request, claim_id):
    """Approve or reject a student claim request."""
    claim = get_object_or_404(ClaimRequest, id=claim_id)
    new_status = request.POST.get('status', '').strip().lower()

    if new_status in ['pending', 'approved', 'rejected']:
        claim.status = new_status
        claim.save()

        # Notify the claimant if they have an active user account
        claimant_user = User.objects.filter(
            Q(username__iexact=claim.claimant_name) |
            Q(email__iexact=claim.claimant_contact)
        ).first()

        if claimant_user:
            if new_status == 'approved':
                create_notification(
                    recipient=claimant_user,
                    title="Your claim was approved",
                    message=f"Good news! Your claim for '{claim.item.name}' has been approved by campus administration.",
                    notification_type="claim_approved",
                    related_item=claim.item,
                    related_claim=claim,
                    target_url="#community-board",
                )
            elif new_status == 'rejected':
                create_notification(
                    recipient=claimant_user,
                    title="Claim Request Update",
                    message=f"Your claim request for '{claim.item.name}' could not be approved at this time.",
                    notification_type="claim_rejected",
                    related_item=claim.item,
                    related_claim=claim,
                    target_url="#community-board",
                )

        messages.success(
            request,
            f"Claim #{claim.id} for '{claim.item.name}' by {claim.claimant_name} marked as {new_status.title()}."
        )
    return redirect('admin_claims')


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_users(request):
    """Manage registered users safely without exposing passwords."""
    q = request.GET.get('q', '').strip()
    users = (
        User.objects.annotate(reported_count=Count('reported_items'))
        .order_by('-date_joined')
    )

    if q:
        users = users.filter(
            Q(username__icontains=q) |
            Q(email__icontains=q) |
            Q(first_name__icontains=q) |
            Q(last_name__icontains=q)
        )

    total_users_count = User.objects.count()
    active_users_count = User.objects.filter(is_active=True).count()
    staff_users_count = User.objects.filter(Q(is_staff=True) | Q(is_superuser=True)).count()
    inactive_users_count = User.objects.filter(is_active=False).count()
    pending_claims_count = ClaimRequest.objects.filter(status='pending').count()

    context = {
        'active_page': 'users',
        'users': users,
        'query': q,
        'total_users_count': total_users_count,
        'active_users_count': active_users_count,
        'staff_users_count': staff_users_count,
        'inactive_users_count': inactive_users_count,
        'pending_claims_count': pending_claims_count,
    }
    return render(request, 'myapp/admin/users.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
@require_POST
@csrf_protect
def admin_toggle_user_status(request, user_id):
    """Safely activate or deactivate a user account."""
    target_user = get_object_or_404(User, id=user_id)

    if target_user.id == request.user.id:
        messages.error(request, "Security protection: You cannot deactivate your own account.")
        return redirect('admin_users')

    target_user.is_active = not target_user.is_active
    target_user.save()

    status_word = "activated" if target_user.is_active else "deactivated"
    messages.success(request, f"User account '{target_user.username}' has been {status_word}.")
    return redirect('admin_users')


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_analytics(request):
    """Detailed campus reports and analytics."""
    total_items = Item.objects.count()
    total_claims = ClaimRequest.objects.count()
    approved_claims = ClaimRequest.objects.filter(status='approved').count()
    pending_claims = ClaimRequest.objects.filter(status='pending').count()

    return_rate = 95
    if total_claims > 0:
        return_rate = int((approved_claims / total_claims) * 100)

    # Top category
    top_cat_item = (
        Item.objects.values('category')
        .annotate(cnt=Count('id'))
        .order_by('-cnt')
        .first()
    )
    top_category = top_cat_item['category'] if top_cat_item else "Electronics"

    # Top location
    top_loc_item = (
        Item.objects.values('location')
        .annotate(cnt=Count('id'))
        .order_by('-cnt')
        .first()
    )
    top_location = top_loc_item['location'] if top_loc_item else "Central Library"

    # Location activity stats table
    loc_qs = (
        Item.objects.values('location')
        .annotate(total=Count('id'))
        .order_by('-total')[:10]
    )
    location_stats = []
    for loc in loc_qs:
        l_name = loc['location']
        l_lost = Item.objects.filter(location=l_name, item_type='lost').count()
        l_found = Item.objects.filter(location=l_name, item_type='found').count()
        location_stats.append({
            'location': l_name,
            'total': loc['total'],
            'lost': l_lost,
            'found': l_found,
        })

    # Category chart data
    cat_qs = Item.objects.values('category').annotate(count=Count('id')).order_by('-count')
    category_labels = [c['category'] for c in cat_qs]
    category_counts = [c['count'] for c in cat_qs]

    # Monthly chart data
    now = timezone.now()
    month_labels = []
    month_counts = []
    for i in range(5, -1, -1):
        target_year = now.year
        target_month = now.month - i
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        m_name = datetime(target_year, target_month, 1).strftime('%b')
        month_labels.append(m_name)
        cnt = Item.objects.filter(created_at__year=target_year, created_at__month=target_month).count()
        month_counts.append(cnt)

    chart_data = {
        'category_labels': category_labels or ["Electronics", "ID Cards", "Books & Notes", "Keys", "Accessories"],
        'category_counts': category_counts or [0, 0, 0, 0, 0],
        'month_labels': month_labels,
        'month_counts': month_counts,
    }

    context = {
        'active_page': 'analytics',
        'return_rate': return_rate,
        'top_category': top_category,
        'top_location': top_location,
        'location_stats': location_stats,
        'chart_data': chart_data,
        'pending_claims_count': pending_claims,
    }
    return render(request, 'myapp/admin/analytics.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_activity(request):
    """Chronological stream of student actions across CampusFind."""
    filter_type = request.GET.get('type', '').strip().lower()

    recent_items = (
        Item.objects.select_related('user')
        .order_by('-created_at')[:40]
    )
    recent_claims = (
        ClaimRequest.objects.select_related('item')
        .order_by('-created_at')[:40]
    )

    activity_list = []

    if filter_type != 'claims':
        for item in recent_items:
            activity_list.append({
                'timestamp': item.created_at,
                'type': 'lost_item' if item.item_type == 'lost' else 'found_item',
                'actor': item.user.username if item.user else 'Guest',
                'item_name': item.name,
                'detail': f"{item.category} reported at {item.location}",
            })

    if filter_type != 'items':
        for claim in recent_claims:
            activity_list.append({
                'timestamp': claim.created_at,
                'type': 'claim',
                'actor': claim.claimant_name,
                'item_name': claim.item.name,
                'detail': f"Contact: {claim.claimant_contact} &bull; Status: {claim.status.title()}",
            })

    # Sort combined activity chronologically descending
    activity_list.sort(key=lambda x: x['timestamp'], reverse=True)

    pending_claims_count = ClaimRequest.objects.filter(status='pending').count()

    context = {
        'active_page': 'activity',
        'activity_list': activity_list[:50],
        'total_events': len(activity_list),
        'filter_type': filter_type,
        'pending_claims_count': pending_claims_count,
    }
    return render(request, 'myapp/admin/activity.html', context)


@login_required(login_url='login')
@user_passes_test(is_staff_or_admin, login_url='home')
def admin_moderation(request):
    """Review and moderate submitted reports for duplicates or violations."""
    items = Item.objects.select_related('user').order_by('-created_at')

    # Detect potential duplicate items (same name & location reported more than once)
    duplicates = (
        Item.objects.values('name', 'category', 'location')
        .annotate(count=Count('id'))
        .filter(count__gt=1)
        .order_by('-count')
    )

    total_items = Item.objects.count()
    pending_claims = ClaimRequest.objects.filter(status='pending').count()

    context = {
        'active_page': 'moderation',
        'items': items,
        'duplicates': duplicates,
        'total_items': total_items,
        'pending_claims': pending_claims,
        'pending_claims_count': pending_claims,
    }
    return render(request, 'myapp/admin/moderation.html', context)
