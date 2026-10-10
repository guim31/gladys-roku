# Roku

Pilotez vos **lecteurs Roku** (Express, Streaming Stick, Ultra…) et vos
**Roku TV** (TCL, Hisense, onn., Sharp, Philips, Westinghouse, téléviseurs
Roku…) depuis Gladys : marche/arrêt, application à l'écran, lecture, touches
de télécommande, volume et entrées, sur le tableau de bord et dans vos scènes.

Tout reste **sur votre réseau local** : Gladys parle au Roku avec le protocole
de contrôle externe (ECP) que Roku documente pour ses appareils. Pas de compte
Roku, pas de cloud, pas de clé d'API.

> **Développée sans le matériel : retours bienvenus.** Cette intégration a été
> écrite à partir de la documentation de Roku et de vraies réponses d'appareils
> Roku enregistrées par d'autres projets libres, pas devant un Roku. Si quelque
> chose ne marche pas comme décrit ici, ouvrez un ticket (voir
> [Signaler un problème](#signaler-un-problème)) : il sera vite corrigé.

## Avant de commencer : autoriser le contrôle depuis le réseau

Les versions récentes de Roku OS bloquent par défaut le contrôle depuis
d'autres appareils. Sur **chaque** Roku :

1. Appuyez sur **Accueil** de la télécommande Roku, ouvrez **Paramètres >
   Système > Paramètres système avancés > Contrôle par applications mobiles**
   (en anglais : _Settings > System > Advanced system settings > Control by
   mobile apps_).
2. Ouvrez **Accès réseau** (_Network access_) et choisissez **Activé**
   (_Enabled_).
   - **Limité** (_Limited_, le réglage par défaut des versions récentes) ne
     permet que d'ouvrir des applications et de saisir du texte : les touches
     de télécommande sont refusées et, selon la version de Roku OS, ce que
     Gladys lit aussi.
   - **Désactivé** (_Disabled_) refuse tout.
   - **Permissif** (_Permissive_) fonctionne aussi, mais ouvre le Roku à
     n'importe quel appareil, même hors de votre réseau : **Activé** suffit à
     Gladys.

Sur une **Roku TV**, activez aussi **Paramètres > Système > Alimentation >
Démarrage rapide de la TV** (_Settings > System > Power > Fast TV start_). Sans
lui, une TV en veille devient sourde au réseau : Gladys ne peut ni l'allumer,
ni savoir qu'elle est éteinte plutôt que débranchée.

Donnez à chaque Roku une adresse fixe dans votre box (« réservation DHCP ») :
Gladys retrouve un Roku qui a changé d'adresse, mais il lui faut une recherche.

## Installation

1. Installez l'intégration **Roku** depuis le magasin d'intégrations de
   Gladys.
2. Ouvrez son onglet **Découverte** et lancez une recherche : chaque Roku du
   même réseau que Gladys répond en quelques secondes.
3. Cliquez sur **Ajouter à Gladys** pour chaque Roku voulu. C'est tout.

Un Roku que la recherche ne trouve pas (autre sous-réseau ou VLAN, réseau
maillé qui filtre la découverte…) ? Dans l'onglet **Configuration**, saisissez
son adresse IP dans **Adresses des Roku** (plusieurs adresses séparées par des
virgules), enregistrez et relancez la recherche. L'action **Tester la
connexion à un Roku** accepte aussi une adresse : elle dit tout de suite si le
Roku répond et accepte le contrôle, et l'ajoute à l'onglet Découverte si oui.

L'adresse d'un Roku s'affiche sur le Roku dans **Paramètres > Réseau > À
propos**.

## Ce que vous obtenez

Chaque Roku devient un appareil Gladys :

| Fonctionnalité | Lecteurs Roku                                                                                                  | Roku TV                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Alimentation   | état (allumé / en veille)                                                                                      | marche / arrêt, et son état                                                                  |
| Application    | l'application à l'écran, et une liste pour en ouvrir une autre (ou l'accueil)                                  | idem                                                                                         |
| Entrée         | –                                                                                                              | HDMI 1 à 4, antenne (TV en direct), AV, ou le streaming Roku, avec les noms donnés sur la TV |
| Lecture        | en lecture ou non                                                                                              | en lecture ou non                                                                            |
| Touches        | Accueil, Retour, flèches, OK, Options (\*), Lecture/Pause, Retour rapide, Avance rapide, Relecture instantanée | idem, plus Volume +, Volume −, Sourdine, Chaîne suivante/précédente (avec tuner)             |

Les états sont relus toutes les 10 secondes. La liste des applications est
relue toutes les 15 minutes, et dès qu'une application absente de la liste
arrive à l'écran.

### Ce qu'un Roku ne sait pas faire (et Gladys non plus)

- **Pas de niveau de volume.** Le protocole de Roku n'a que les touches
  Volume +, Volume − et Sourdine : pas de « mettre le volume à 20 », aucun
  moyen de lire le niveau actuel ni de savoir si le son est coupé. Gladys
  propose les touches et n'affiche rien qu'elle ne peut pas savoir.
- **Un lecteur Roku ne s'éteint pas.** Un Roku Express, Stick ou Ultra n'a
  pas de vrai état d'alimentation : Gladys montre s'il est actif ou en veille,
  mais seule une Roku TV s'allume et s'éteint.
- **Allumer une TV en veille profonde** exige le **Démarrage rapide de la
  TV** (voir plus haut). Quand la TV ne répond pas, Gladys lui envoie d'abord
  un paquet Wake-on-LAN : le réveil dépend du modèle, et marche plus souvent
  en Ethernet qu'en Wi-Fi.
- **Les touches volume et marche d'un lecteur** (celles de la télécommande
  vocale qui pilotent votre TV en HDMI-CEC ou infrarouge) ne passent pas par
  le réseau.
- **La saisie de texte** (champs de recherche) n'est pas encore prise en
  charge.

## Tableau de bord

Trois widgets sont fournis (Gladys 5.1 ou plus récent). Chacun montre le Roku
choisi dans ses réglages, ou le premier.

- **Télécommande Roku** — alimentation et application à l'écran, puis
  **Allumer/Éteindre** (Roku TV) ou **Lecture/Pause** (lecteur),
  **Accueil**, **Retour** et **OK**. Un widget a quatre boutons au plus :
  les autres touches (flèches, volume, sourdine…) sont sur la page de
  l'appareil et dans l'action de scène « Appuyer sur une touche de
  télécommande Roku ».
- **Lecture Roku** — l'icône et le nom de l'application à l'écran, en lecture
  ou en pause, la position dans la vidéo quand une vidéo est ouverte, et
  Lecture/Pause, Retour rapide, Avance rapide, Relecture.
- **Applications Roku** — **quatre raccourcis au plus** par widget, avec
  leurs icônes (une limite du tableau de bord de Gladys). Réglages vides : les
  quatre premières applications installées ; **saisissez les noms voulus**
  dans les réglages du widget (ex. `Disney+`, `KiKA`, `YouTube` : majuscules
  et accents indifférents). Pour en avoir plus, ajoutez un second widget
  **Applications Roku** avec quatre autres noms. L'application à l'écran est
  marquée.

**Toutes les applications installées**, sans limite, sont dans la
fonctionnalité **Application** de l'appareil : ajoutez l'appareil à une boîte
**Appareils** classique pour choisir n'importe quelle application dans une
liste, ou utilisez-la dans une scène avec « Contrôler un appareil » (les
entrées de la TV sont dans la fonctionnalité **Entrée** d'une Roku TV).

Les fonctionnalités de l'appareil peuvent aussi être ajoutées à n'importe
quelle boîte classique du tableau de bord.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes, dans la
catégorie **Intégrations** :

- **Application Roku changée** (déclencheur) — lance la scène quand une
  application arrive à l'écran, en 10 secondes environ. Choisissez si besoin
  le Roku et saisissez le nom de l'application **exactement comme le Roku
  l'affiche** (ex. `Netflix`, ou `Home` pour l'écran d'accueil). Les actions
  suivantes peuvent utiliser le nom de l'application et son identifiant Roku.
  Exemple : _quand Netflix démarre sur la TV du salon, baisser la lumière_.
- **Ouvrir une application sur un Roku** (action) — ouvre une application
  installée par son nom. Exemple : _soirée film : allumer la TV, ouvrir
  Netflix_.
- **Appuyer sur une touche de télécommande Roku** (action) — n'importe quelle
  touche, autant de fois que nécessaire, y compris Allumer et Éteindre pour une
  Roku TV. Exemple : _quand on sonne, appuyer sur Lecture/Pause_.

Les états d'alimentation et de lecture sont des fonctionnalités classiques :
une scène peut démarrer quand la TV s'éteint, ou vérifier qu'une lecture est
en cours.

## Dépannage

**« … refuse le contrôle à distance »** (dans l'onglet Configuration, un
widget ou une action) : le Roku est réglé sur Limité ou Désactivé. Réglez
**Contrôle par applications mobiles > Accès réseau** sur **Activé** (voir
[Avant de commencer](#avant-de-commencer--autoriser-le-contrôle-depuis-le-réseau)),
puis lancez **Tester la connexion à un Roku**.

**La recherche ne trouve rien.** Gladys et le Roku doivent être sur le même
réseau (même sous-réseau, pas de Wi-Fi invité, pas d'isolation des clients).
Saisissez l'adresse du Roku dans **Adresses des Roku**, enregistrez et
relancez la recherche.

**Le Roku apparaît éteint alors qu'il est allumé.** Il ne répond plus :
vérifiez son adresse (elle a pu changer), puis lancez **Tester la connexion à
un Roku**.

**Une Roku TV ne s'allume pas.** Activez le **Démarrage rapide de la TV**. En
Wi-Fi, le Wake-on-LAN peut ne pas l'atteindre pendant sa veille.

**Une application manque dans la liste.** La liste est relue toutes les 15
minutes : patientez, ou ouvrez une fois l'application sur le Roku.

## Signaler un problème

1. Dans l'onglet **Configuration**, activez **Journaux de débogage** et
   enregistrez.
2. Reproduisez le problème, puis copiez les journaux de l'intégration (page de
   l'intégration > Journaux).
3. Ouvrez un ticket sur
   [github.com/guim31/gladys-roku](https://github.com/guim31/gladys-roku/issues)
   avec les journaux, le modèle de votre Roku et sa version de Roku OS
   (Paramètres > Système > À propos). Les journaux ne contiennent aucun mot de
   passe ; ils montrent le modèle du Roku, son adresse sur votre réseau et son
   numéro de série.

Désactivez ensuite les journaux de débogage : ils sont bavards.

---

Sans lien avec Roku, Inc. Roku est une marque de Roku, Inc.
