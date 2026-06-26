#include <QApplication>
#include <QMainWindow>
#include <QLabel>
#include <QFont>

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);

    QMainWindow* win = new QMainWindow();
    win->setWindowTitle("VeighNa");
    win->resize(800, 600);

    QLabel* label = new QLabel("Hello Qt6 WASM!");
    QFont f("Arial", 32, QFont::Bold);
    label->setFont(f);
    label->setAlignment(Qt::AlignCenter);
    label->setStyleSheet("color:white; background:#222; padding:40px;");

    win->setCentralWidget(label);
    win->setStyleSheet("background:#222;");
    win->show();

    return app.exec();
}
