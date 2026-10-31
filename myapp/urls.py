from django.urls import path
from . import views

urlpatterns = [
    path('', views.login_view, name='login'),
    path('login/', views.login_view, name='login_page'),
    path('register/', views.register_view, name='register'),
    path('home/', views.home, name='home'),
    path('profile/', views.profile_view, name='profile'),
    path('profile/edit/', views.edit_profile_view, name='edit_profile'),
    path('profile/delete-account/', views.delete_account_view, name='delete_account'),
    path('profile/items/<int:item_id>/delete/', views.delete_item_view, name='delete_item_view'),
    path('logout/', views.logout_view, name='logout'),

    # Custom Admin Dashboard & Management
    path('admin-dashboard/', views.admin_dashboard, name='admin_dashboard'),
    path('admin-dashboard/items/', views.admin_items, name='admin_items'),
    path('admin-dashboard/items/<int:item_id>/edit/', views.admin_edit_item, name='admin_edit_item'),
    path('admin-dashboard/items/<int:item_id>/delete/', views.admin_delete_item, name='admin_delete_item'),
    path('admin-dashboard/claims/', views.admin_claims, name='admin_claims'),
    path('admin-dashboard/claims/<int:claim_id>/update/', views.admin_update_claim_status, name='admin_update_claim_status'),
    path('admin-dashboard/users/', views.admin_users, name='admin_users'),
    path('admin-dashboard/users/<int:user_id>/toggle-status/', views.admin_toggle_user_status, name='admin_toggle_user_status'),
    path('admin-dashboard/analytics/', views.admin_analytics, name='admin_analytics'),
    path('admin-dashboard/activity/', views.admin_activity, name='admin_activity'),
    path('admin-dashboard/moderation/', views.admin_moderation, name='admin_moderation'),

    path('api/items/', views.items_api, name='items_api'),
    path('api/items/<int:item_id>/delete/', views.delete_item_api, name='delete_item_api'),
    path('api/claims/', views.claims_api, name='claims_api'),
    path('api/chatbot/', views.chatbot_api, name='chatbot_api'),

    # Notifications API
    path('api/notifications/', views.notifications_api, name='notifications_api'),
    path('api/notifications/<int:notification_id>/read/', views.mark_notification_read_api, name='mark_notification_read_api'),
    path('api/notifications/mark-all-read/', views.mark_all_notifications_read_api, name='mark_all_notifications_read_api'),
    path('api/notifications/unread-count/', views.unread_notifications_count_api, name='unread_notifications_count_api'),
]
