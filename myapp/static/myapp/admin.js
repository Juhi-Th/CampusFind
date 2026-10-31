/**
 * CampusFind Admin Dashboard Interactive Utilities
 */

document.addEventListener('DOMContentLoaded', function () {
    // ================= MOBILE SIDEBAR TOGGLE =================
    const sidebar = document.getElementById('adminSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const closeBtn = document.getElementById('sidebarCloseBtn');
    const backdrop = document.getElementById('sidebarBackdrop');

    function openSidebar() {
        document.body.classList.add('sidebar-open');
    }

    function closeSidebar() {
        document.body.classList.remove('sidebar-open');
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', openSidebar);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebar);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeSidebar);
    }

    // ================= MODAL CONTROLLER =================
    window.openModal = function (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    };

    window.closeModal = function (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    };

    // Close modal on backdrop click or Escape key
    document.querySelectorAll('.admin-modal-backdrop').forEach(modal => {
        modal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.admin-modal-backdrop.active').forEach(modal => {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            });
            closeSidebar();
        }
    });

    // ================= CLIENT-SIDE TABLE SEARCH FILTER =================
    const searchInputs = document.querySelectorAll('[data-table-search]');
    searchInputs.forEach(input => {
        const targetTableId = input.getAttribute('data-table-search');
        const targetTable = document.getElementById(targetTableId);
        if (!targetTable) return;

        input.addEventListener('input', function () {
            const query = this.value.toLowerCase().trim();
            const rows = targetTable.querySelectorAll('tbody tr');

            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                if (text.includes(query)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    });
});

