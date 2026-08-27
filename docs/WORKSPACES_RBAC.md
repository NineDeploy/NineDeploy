# Workspaces & Role-Based Access Control (RBAC)

NineDeploy provides multi-tenant Workspaces, allowing engineering organizations to partition services, databases, secrets, and servers into isolated scopes with team access controls.

---

## 🏢 1. Workspace Scoping

Every resource in NineDeploy belongs to a Workspace:
- **Services & Containers**
- **Managed Databases & Volumes**
- **Domains & SSL Certificates**
- **Secrets & Environment Variables**
- **Connected Servers & Remote Agents**

Users can seamlessly switch between Workspaces from the dashboard header or CLI without re-authenticating.

---

## 👥 2. Role Hierarchy & Permission Matrix

NineDeploy provides four distinct role levels within each workspace:

| Permission | Owner | Admin | Member | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| **Workspace Settings & Billing** | ✅ | ❌ | ❌ | ❌ |
| **Transfer / Delete Workspace** | ✅ | ❌ | ❌ | ❌ |
| **Manage Team Members & Roles** | ✅ | ✅ | ❌ | ❌ |
| **Create & Delete Services / DBs** | ✅ | ✅ | ❌ | ❌ |
| **Trigger Deploys & Rollbacks** | ✅ | ✅ | ✅ | ❌ |
| **Edit Environment Variables** | ✅ | ✅ | ✅ | ❌ |
| **View Secrets & Credentials** | ✅ | ✅ | ❌ | ❌ |
| **View Dashboard, Metrics & Logs** | ✅ | ✅ | ✅ | ✅ |

---

## ✉️ 3. Team Invitations & Member Management

1. **Invite Links**: Admins generate time-limited invitation tokens or send direct email invites.
2. **Role Assignment**: Assign appropriate roles upon invitation or update existing member privileges.
3. **Revocation**: Removing a member immediately revokes their workspace tokens and active sessions.
