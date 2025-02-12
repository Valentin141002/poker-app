// App.js
import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "./screens/HomeScreen"; // votre écran d'accueil avec le bouton "JOUER"
import GameScreen from "./screens/GameScreen"; // l'écran de jeu

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Accueil" }} />
        <Stack.Screen name="Game" component={GameScreen} options={{ title: "Jeu" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
