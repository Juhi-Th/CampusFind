from django.db import models
from django.contrib.auth.models import User


class Item(models.Model):
    ITEM_TYPES = [
        ("lost", "Lost"),
        ("found", "Found"),
    ]

    CATEGORIES = [
        ("Electronics", "Electronics"),
        ("ID Cards", "ID Cards"),
        ("Books & Notes", "Books & Notes"),
        ("Keys", "Keys"),
        ("Accessories", "Accessories"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="reported_items",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=200)
    item_type = models.CharField(max_length=10, choices=ITEM_TYPES)
    category = models.CharField(max_length=50, choices=CATEGORIES)
    location = models.CharField(max_length=200)
    date = models.DateField()
    contact = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="item_photos/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.item_type})"

    @property
    def image_url(self):
        if self.image:
            try:
                return self.image.url
            except Exception:
                pass
        from .category_images import get_item_image_url
        return get_item_image_url(self)


class ClaimRequest(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="claims"
    )
    claimant_name = models.CharField(max_length=100)
    claimant_contact = models.CharField(max_length=150)
    message = models.TextField()
    status = models.CharField(
        max_length=10,
        choices=STATUS_CHOICES,
        default="pending"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Claim for {self.item.name} by {self.claimant_name}"


class Notification(models.Model):
    TYPE_CHOICES = [
        ("new_item", "New Item Reported"),
        ("new_claim", "New Claim Request"),
        ("claim_approved", "Claim Approved"),
        ("claim_rejected", "Claim Rejected"),
        ("item_removed", "Item Removed"),
        ("system", "System Notification"),
    ]

    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="notifications"
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    notification_type = models.CharField(
        max_length=30,
        choices=TYPE_CHOICES,
        default="system"
    )
    related_item = models.ForeignKey(
        Item,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications"
    )
    related_claim = models.ForeignKey(
        ClaimRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications"
    )
    target_url = models.CharField(max_length=255, blank=True, default="")
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Notification for {self.recipient.username}: {self.title}"

