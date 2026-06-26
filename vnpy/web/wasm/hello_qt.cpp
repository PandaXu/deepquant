#include <QApplication>
#include <QMainWindow>
#include <QPushButton>

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    QMainWindow* win = new QMainWindow();
    win->setWindowTitle("VeighNa Qt6");

    QPushButton* btn = new QPushButton("CLICK ME");
    btn->setStyleSheet("QPushButton { background:#007acc; color:white; font-size:32px; padding:30px; border:none; border-radius:8px; }");
    win->setCentralWidget(btn);
    win->setStyleSheet("QMainWindow { background:#333; }");
    win->show();

    return app.exec();
}
