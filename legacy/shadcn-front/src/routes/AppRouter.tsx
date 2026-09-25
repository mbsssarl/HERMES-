import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { FullPageLoader } from "../components/common/FullPageLoader";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage";
import { LoginPage } from "../features/auth/LoginPage";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage";
import { SetPasswordGate } from "../features/auth/SetPasswordGate";
import { SetPasswordPage } from "../features/auth/SetPasswordPage";
import { MainLayout } from "../layouts/MainLayout";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage";
import { ActivityLogPage } from "../features/admin/ActivityLogPage";
import { CountriesManagementPage } from "../features/admin/CountriesManagementPage";
import { SettingsPage } from "../features/admin/SettingsPage";
import { UsersManagementPage } from "../features/admin/UsersManagementPage";
import { OrderDetailPage } from "../features/orders/OrderDetailPage";
import { OrdersListPage } from "../features/orders/OrdersListPage";
import { ProductsListPage } from "../features/products/ProductsListPage";
import { SupplierValidationPage } from "../features/products/SupplierValidationPage";
import { AdminOnlyRoute } from "./AdminOnlyRoute";

export function AppRouter() {
  return (
    <>
      <AuthLoading>
        <FullPageLoader />
      </AuthLoading>

      <Unauthenticated>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Unauthenticated>

      <Authenticated>
        <SetPasswordGate>
          <MainLayout>
            <Routes>
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route path="/set-password" element={<SetPasswordPage forced={false} />} />
              <Route path="/orders" element={<OrdersListPage />} />
              <Route path="/orders/:orderId" element={<OrderDetailPage />} />
              <Route path="/products" element={<ProductsListPage />} />
              <Route path="/orders/:orderId/supplier-validation" element={<SupplierValidationPage />} />
              <Route
                path="/admin"
                element={
                  <AdminOnlyRoute>
                    <AdminDashboardPage />
                  </AdminOnlyRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <AdminOnlyRoute>
                    <UsersManagementPage />
                  </AdminOnlyRoute>
                }
              />
              <Route
                path="/admin/countries"
                element={
                  <AdminOnlyRoute>
                    <CountriesManagementPage />
                  </AdminOnlyRoute>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  <AdminOnlyRoute>
                    <SettingsPage />
                  </AdminOnlyRoute>
                }
              />
              <Route
                path="/admin/activity"
                element={
                  <AdminOnlyRoute>
                    <ActivityLogPage />
                  </AdminOnlyRoute>
                }
              />
              <Route path="*" element={<Navigate to="/orders" replace />} />
            </Routes>
          </MainLayout>
        </SetPasswordGate>
      </Authenticated>
    </>
  );
}
