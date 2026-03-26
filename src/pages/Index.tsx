import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, LogOut, User, Navigation, Accessibility } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Зареждане...</div>
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-6 h-6 text-primary" />
            <span className="font-bold text-lg text-foreground">AccessRoute</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            Добре дошли! 👋
          </h1>
          <p className="text-muted-foreground">
            Намерете най-удобния маршрут за вас.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                <Navigation className="w-5 h-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Планирай маршрут</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Въведете начална и крайна точка за персонализиран маршрут.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center mb-2">
                <Accessibility className="w-5 h-5 text-secondary" />
              </div>
              <CardTitle className="text-lg">Моят профил</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Настройте предпочитанията си за достъпност.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center mb-2">
                <User className="w-5 h-5 text-accent-foreground" />
              </div>
              <CardTitle className="text-lg">Запазени маршрути</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Преглед на вашите предишни и любими маршрути.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Index;
